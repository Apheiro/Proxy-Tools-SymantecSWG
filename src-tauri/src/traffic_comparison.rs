//! Read-only comparisons of saved v3 projections. Never reads canonical/raw log payloads.
use crate::traffic_store::{self, TrafficCaptureScope};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::AppHandle;
type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    capture_ids: Vec<String>,
    scope: TrafficCaptureScope,
    #[serde(default)]
    include_unassigned: bool,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Span {
    pub start: i64,
    pub end: i64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    id: String,
    label: String,
    start: i64,
    end: i64,
    #[serde(default)]
    ranges: Vec<Span>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonRequest {
    #[serde(flatten)]
    selection: Selection,
    periods: Vec<Period>,
    metric: String,
    top_n: usize,
    #[serde(default = "default_bucket")]
    bucket_seconds: i64,
}
fn default_bucket() -> i64 {
    60
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: String,
    source: String,
    scope: Option<TrafficCaptureScope>,
    first: Option<i64>,
    last: Option<i64>,
    records: i64,
    untimed_records: i64,
    unassigned_diagnostics: i64,
    diagnostics_total: i64,
    field_availability: Vec<crate::traffic_analysis::FieldAvailability>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    sources: Vec<Source>,
    utc_minutes: Vec<i64>,
}
#[derive(Clone, Default, Serialize)]
pub struct Count {
    requests: i64,
    bytes: i64,
}
#[derive(Clone, Serialize)]
pub struct Ranking {
    name: String,
    requests: i64,
    bytes: i64,
}
#[derive(Serialize)]
pub struct Bucket {
    epoch: i64,
    requests: i64,
    bytes: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodResult {
    #[serde(flatten)]
    period: Period,
    first: Option<i64>,
    last: Option<i64>,
    requests: i64,
    bytes: i64,
    http4xx: i64,
    http5xx: i64,
    denied: i64,
    issues: i64,
    parse_failures: i64,
    clients: usize,
    hosts: usize,
    active_minutes: usize,
    max_event_gap_ms: i64,
    observed_duration_ms: i64,
    timeline: Vec<Bucket>,
    rankings: BTreeMap<String, Vec<Ranking>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityValue {
    period_id: String,
    requests: i64,
    bytes: i64,
}
#[derive(Serialize)]
pub struct CommonEntity {
    name: String,
    values: Vec<EntityValue>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceChange {
    from_period: String,
    to_period: String,
    emerged: Vec<Ranking>,
    disappeared: Vec<Ranking>,
}
#[derive(Serialize)]
pub struct Comparison {
    periods: Vec<PeriodResult>,
    common: BTreeMap<String, Vec<CommonEntity>>,
    changes: BTreeMap<String, Vec<PresenceChange>>,
    excluded: usize,
    sources: Vec<Source>,
}
struct Run {
    cancelled: AtomicBool,
    handles: Mutex<Vec<rusqlite::InterruptHandle>>,
}
static RUNS: OnceLock<Mutex<HashMap<String, Arc<Run>>>> = OnceLock::new();
static CANCELLED: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
struct Guard {
    id: String,
    run: Arc<Run>,
}
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut runs) = RUNS.get_or_init(Default::default).lock() {
            if runs
                .get(&self.id)
                .is_some_and(|r| Arc::ptr_eq(r, &self.run))
            {
                runs.remove(&self.id);
            }
        }
    }
}
impl Guard {
    fn new(id: String) -> Result<Self> {
        let cancelled = CANCELLED
            .get_or_init(Default::default)
            .lock()
            .map_err(|e| e.to_string())?;
        if cancelled.contains(&id) {
            return Err("Comparison cancelled".into());
        }
        let run = Arc::new(Run {
            cancelled: AtomicBool::new(false),
            handles: Mutex::new(Vec::new()),
        });
        RUNS.get_or_init(Default::default)
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), run.clone());
        Ok(Self { id, run })
    }
    fn check(&self) -> Result<()> {
        if self.run.cancelled.load(Ordering::Relaxed) {
            Err("Comparison cancelled".into())
        } else {
            Ok(())
        }
    }
}
#[tauri::command]
pub fn cancel_traffic_comparison(request_id: String) -> Result<()> {
    let mut cancelled = CANCELLED
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?;
    cancelled.push_back(request_id.clone());
    while cancelled.len() > 128 {
        cancelled.pop_front();
    }
    if let Some(run) = RUNS
        .get_or_init(Default::default)
        .lock()
        .map_err(|e| e.to_string())?
        .get(&request_id)
    {
        run.cancelled.store(true, Ordering::Relaxed);
        for handle in run.handles.lock().map_err(|e| e.to_string())?.iter() {
            handle.interrupt();
        }
    }
    Ok(())
}
fn selection(
    app: &AppHandle,
    selection: &Selection,
    guard: &Guard,
) -> Result<Vec<(Connection, Source)>> {
    selection.scope.validate()?;
    if selection.capture_ids.is_empty() || selection.capture_ids.len() > 32 {
        return Err("Select between 1 and 32 saved captures.".into());
    }
    let mut ids = HashSet::new();
    let mut out: Vec<(Connection, Source)> = Vec::new();
    for id in &selection.capture_ids {
        guard.check()?;
        if !ids.insert(id) {
            return Err("A capture cannot be selected twice.".into());
        }
        let conn = traffic_store::open(app, id)?;
        guard
            .run
            .handles
            .lock()
            .map_err(|e| e.to_string())?
            .push(conn.get_interrupt_handle());
        guard.check()?;
        let meta = |key: &str| -> Result<Option<String>> {
            conn.query_row("SELECT value FROM meta WHERE key=?", [key], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())
        };
        if meta("version")?.as_deref() != Some("3") {
            return Err("Comparative reports require already indexed SQLite v3 captures. This capture is not converted automatically.".into());
        }
        if meta("saved")?.as_deref() != Some("1") || meta("complete")?.as_deref() != Some("1") {
            return Err("Only saved, fully processed captures can be compared.".into());
        }
        let scope: Option<TrafficCaptureScope> = meta("capture_scope")?
            .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
            .transpose()?;
        match &scope {
            Some(actual) if actual != &selection.scope => return Err(
                "Capture belongs to another proxy or data profile. Select it in its own context."
                    .into(),
            ),
            None if !selection.include_unassigned => {
                return Err("Unassigned captures require explicit inclusion.".into())
            }
            _ => {}
        }
        let (first, last, records, untimed_records) = conn
            .query_row(
                "SELECT MIN(ts),MAX(ts),COUNT(*),COUNT(*)-COUNT(ts) FROM records",
                [],
                |r| {
                    Ok((
                        r.get::<_, Option<i64>>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        let availability: Option<String> = conn
            .query_row(
                "SELECT json_extract(value,'$.fieldAvailability') FROM meta WHERE key='dataset'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        let source = Source {
            id: id.clone(),
            source: meta("source")?.unwrap_or_default(),
            scope,
            first,
            last,
            records,
            untimed_records,
            field_availability: availability
                .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
                .transpose()?
                .unwrap_or_default(),
            diagnostics_total: conn
                .query_row("SELECT diagnostics FROM totals WHERE id=1", [], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?,
            unassigned_diagnostics: conn
                .query_row(
                    "SELECT COUNT(*) FROM diagnostic_entries WHERE record_id IS NULL",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?,
        };
        // Stable record identity across independent captures is not guaranteed by v3. Reject
        // intersecting observed envelopes instead of silently double counting copied records.
        for (_, other) in &out {
            if let (Some(a), Some(b), Some(c), Some(d)) = (first, last, other.first, other.last) {
                if a <= d && c <= b {
                    return Err("Selected captures have overlapping observed time ranges. Record uniqueness cannot be demonstrated; compare one capture at a time or select non-overlapping captures.".into());
                }
            }
        }
        out.push((conn, source));
    }
    Ok(out)
}
/// List only immutable, saved v3 projections. Legacy JSON/v2 is deliberately not
/// upgraded or reparsed by this tool. Unassigned is a separate explicit browse mode.
#[tauri::command]
pub async fn list_traffic_comparison_captures(
    app: AppHandle,
    scope: TrafficCaptureScope,
    unassigned: bool,
) -> Result<Vec<traffic_store::SavedCapture>> {
    scope.validate()?;
    tokio::task::spawn_blocking(move || {
        let mut result=Vec::new();
        for capture in traffic_store::list(&app)? {
            if if unassigned { capture.scope.is_some() } else { capture.scope.as_ref()!=Some(&scope) } { continue; }
            let Ok(conn)=traffic_store::open(&app,&capture.id) else {continue};
            let eligible: bool=conn.query_row("SELECT (SELECT value FROM meta WHERE key='version')='3' AND (SELECT value FROM meta WHERE key='complete')='1'",[],|r|r.get(0)).unwrap_or(false);
            if eligible {result.push(capture);}
        }
        result.sort_by(|a,b|b.saved_at.cmp(&a.saved_at));
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn discover_traffic_comparison(
    app: AppHandle,
    capture_ids: Vec<String>,
    scope: TrafficCaptureScope,
    include_unassigned: bool,
    request_id: String,
) -> Result<Discovery> {
    let guard = Guard::new(request_id)?;
    tokio::task::spawn_blocking(move || {
        let selected = selection(&app, &Selection {capture_ids,scope,include_unassigned}, &guard)?;
        let mut minutes = BTreeSet::new();
        for (conn,_) in &selected {
            let mut stmt = conn.prepare("SELECT DISTINCT (ts/60000 - (ts%60000<0))*60000 FROM records WHERE ts IS NOT NULL").map_err(|e|e.to_string())?;
            for row in stmt.query_map([], |r| r.get::<_,i64>(0)).map_err(|e|e.to_string())? { guard.check()?; minutes.insert(row.map_err(|e|e.to_string())?); if minutes.len()>1_000_000 { return Err("Selected captures exceed one million observed minutes. Select a smaller capture set.".into()); } }
        }
        Ok(Discovery { sources: selected.into_iter().map(|(_,s)|s).collect(), utc_minutes: minutes.into_iter().collect() })
    }).await.map_err(|e|e.to_string())?
}

type Entities = BTreeMap<String, BTreeMap<String, Count>>;
fn ranked(entities: &BTreeMap<String, Count>, metric: &str, limit: usize) -> Vec<Ranking> {
    let mut rows: Vec<_> = entities
        .iter()
        .map(|(name, c)| Ranking {
            name: name.clone(),
            requests: c.requests,
            bytes: c.bytes,
        })
        .collect();
    rows.sort_by(|a, b| {
        let (x, y) = if metric == "bytes" {
            (a.bytes, b.bytes)
        } else {
            (a.requests, b.requests)
        };
        y.cmp(&x).then_with(|| a.name.cmp(&b.name))
    });
    rows.truncate(limit);
    rows
}
fn predicate(period: &Period) -> Result<(String, Vec<i64>)> {
    let ranges = if period.ranges.is_empty() {
        vec![Span {
            start: period.start,
            end: period.end,
        }]
    } else {
        period.ranges.clone()
    };
    if period.end <= period.start || ranges.len() > 8 {
        return Err("Invalid comparison period.".into());
    }
    let mut last = None;
    let mut args = Vec::new();
    let mut conditions = Vec::new();
    for range in ranges {
        if range.start < period.start
            || range.end > period.end
            || range.end <= range.start
            || last.is_some_and(|v| range.start < v)
        {
            return Err(
                "Comparison ranges must be ordered, disjoint and inside their period.".into(),
            );
        }
        last = Some(range.end);
        args.extend([range.start, range.end]);
        conditions.push("(r.ts>=? AND r.ts<?)");
    }
    Ok((format!("({})", conditions.join(" OR ")), args))
}
fn compare(
    selected: Vec<(Connection, Source)>,
    request: ComparisonRequest,
    guard: &Guard,
) -> Result<Comparison> {
    if request.periods.is_empty() || request.periods.len() > 730 {
        return Err("Select between 1 and 730 comparison periods.".into());
    }
    if !matches!(request.metric.as_str(), "requests" | "bytes")
        || !(1..=100).contains(&request.top_n)
        || !matches!(request.bucket_seconds, 60 | 900 | 3600)
    {
        return Err("Invalid comparison metric, Top N, or timeline interval.".into());
    }
    let mut results = Vec::new();
    let mut all_entities: Vec<Entities> = Vec::new();
    let mut excluded = 0;
    let mut period_ids = HashSet::new();
    for period in request.periods {
        guard.check()?;
        if !period_ids.insert(period.id.clone()) {
            return Err("Duplicate comparison period.".into());
        }
        let (pred, args) = predicate(&period)?;
        let mut result = PeriodResult {
            period,
            first: None,
            last: None,
            requests: 0,
            bytes: 0,
            http4xx: 0,
            http5xx: 0,
            denied: 0,
            issues: 0,
            parse_failures: 0,
            clients: 0,
            hosts: 0,
            active_minutes: 0,
            max_event_gap_ms: 0,
            observed_duration_ms: 0,
            timeline: Vec::new(),
            rankings: BTreeMap::new(),
        };
        let mut entities: Entities = BTreeMap::new();
        let mut minutes: BTreeMap<i64, Count> = BTreeMap::new();
        for (conn, _) in &selected {
            guard.check()?;
            let sql=format!("SELECT MIN(r.ts),MAX(r.ts),COUNT(*),COALESCE(SUM(r.bytes),0),COALESCE(SUM(CAST(v.name AS INTEGER) BETWEEN 400 AND 499),0),COALESCE(SUM(CAST(v.name AS INTEGER) BETWEEN 500 AND 599),0),COALESCE(SUM(r.denied),0),COALESCE(SUM(r.issue_count>0),0),COALESCE(SUM(EXISTS(SELECT 1 FROM memberships m JOIN vals iv ON iv.id=m.value_id WHERE m.record_id=r.id AND m.field=1 AND iv.name='Malformed record')),0) FROM records r LEFT JOIN vals v ON v.id=r.status WHERE {pred}");
            let (first, last, requests, bytes, h4, h5, denied, issues, parse_failures) = conn
                .query_row(&sql, params_from_iter(args.iter()), |r| {
                    Ok((
                        r.get::<_, Option<i64>>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                        r.get::<_, i64>(6)?,
                        r.get::<_, i64>(7)?,
                        r.get::<_, i64>(8)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            if let Some(t) = first {
                result.first = Some(result.first.map_or(t, |v| v.min(t)));
            }
            if let Some(t) = last {
                result.last = Some(result.last.map_or(t, |v| v.max(t)));
            }
            result.requests += requests;
            result.bytes += bytes;
            result.http4xx += h4;
            result.http5xx += h5;
            result.denied += denied;
            result.issues += issues;
            result.parse_failures += parse_failures;
            let mut stmt=conn.prepare(&format!("SELECT (r.ts/60000 - (r.ts%60000<0))*60000,COUNT(*),SUM(r.bytes) FROM records r WHERE {pred} GROUP BY 1 ORDER BY 1")).map_err(|e|e.to_string())?;
            for row in stmt
                .query_map(params_from_iter(args.iter()), |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (epoch, n, b) = row.map_err(|e| e.to_string())?;
                let c = minutes.entry(epoch).or_default();
                c.requests += n;
                c.bytes += b;
            }
            for field in [
                "host",
                "client",
                "category",
                "action",
                "status",
                "application",
                "user",
            ] {
                guard.check()?;
                let sql = if field == "category" {
                    format!("SELECT v.name,COUNT(*),SUM(r.bytes) FROM records r JOIN memberships m ON m.record_id=r.id AND m.field=0 JOIN vals v ON v.id=m.value_id WHERE {pred} AND v.name<>'' GROUP BY v.name")
                } else {
                    format!("SELECT v.name,COUNT(*),SUM(r.bytes) FROM records r JOIN vals v ON v.id=r.{field} WHERE {pred} AND v.name<>'' GROUP BY v.name")
                };
                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let values = entities.entry(field.into()).or_default();
                for row in stmt
                    .query_map(params_from_iter(args.iter()), |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, i64>(1)?,
                            r.get::<_, i64>(2)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?
                {
                    guard.check()?;
                    let (name, n, b) = row.map_err(|e| e.to_string())?;
                    let c = values.entry(name).or_default();
                    c.requests += n;
                    c.bytes += b;
                }
            }
        }
        if result.requests == 0 {
            excluded += 1;
            continue;
        }
        if let (Some(first), Some(last)) = (result.first, result.last) {
            let ranges = if result.period.ranges.is_empty() {
                vec![Span {
                    start: result.period.start,
                    end: result.period.end,
                }]
            } else {
                result.period.ranges.clone()
            };
            result.observed_duration_ms = ranges
                .iter()
                .map(|r| (last.min(r.end) - first.max(r.start)).max(0))
                .sum();
        }
        result.clients = entities.get("client").map_or(0, |v| v.len());
        result.hosts = entities.get("host").map_or(0, |v| v.len());
        result.active_minutes = minutes.len();
        let mut previous = None;
        let mut buckets: BTreeMap<i64, Count> = BTreeMap::new();
        let width = request.bucket_seconds * 1000;
        for (epoch, c) in minutes {
            if let Some(p) = previous {
                result.max_event_gap_ms = result.max_event_gap_ms.max(epoch - p);
            }
            previous = Some(epoch);
            let b = buckets.entry(epoch.div_euclid(width) * width).or_default();
            b.requests += c.requests;
            b.bytes += c.bytes;
        }
        result.timeline = buckets
            .into_iter()
            .map(|(epoch, c)| Bucket {
                epoch,
                requests: c.requests,
                bytes: c.bytes,
            })
            .collect();
        for (field, values) in &entities {
            result.rankings.insert(
                field.clone(),
                ranked(values, &request.metric, request.top_n),
            );
        }
        all_entities.push(entities);
        results.push(result);
    }
    let mut common = BTreeMap::new();
    let mut changes = BTreeMap::new();
    for field in ["host", "client"] {
        let mut intersection = all_entities
            .first()
            .and_then(|e| e.get(field))
            .cloned()
            .unwrap_or_default();
        for entities in all_entities.iter().skip(1) {
            intersection.retain(|name, count| {
                if let Some(next) = entities.get(field).and_then(|v| v.get(name)) {
                    count.requests += next.requests;
                    count.bytes += next.bytes;
                    true
                } else {
                    false
                }
            });
        }
        common.insert(
            field.into(),
            ranked(&intersection, &request.metric, request.top_n)
                .into_iter()
                .map(|r| CommonEntity {
                    name: r.name.clone(),
                    values: all_entities
                        .iter()
                        .zip(&results)
                        .map(|(e, p)| {
                            let c = &e[field][&r.name];
                            EntityValue {
                                period_id: p.period.id.clone(),
                                requests: c.requests,
                                bytes: c.bytes,
                            }
                        })
                        .collect(),
                })
                .collect(),
        );
        let mut deltas = Vec::new();
        for i in 1..all_entities.len() {
            let before = &all_entities[i - 1][field];
            let after = &all_entities[i][field];
            let emerged = after
                .iter()
                .filter(|(k, _)| !before.contains_key(*k))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            let disappeared = before
                .iter()
                .filter(|(k, _)| !after.contains_key(*k))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            deltas.push(PresenceChange {
                from_period: results[i - 1].period.id.clone(),
                to_period: results[i].period.id.clone(),
                emerged: ranked(&emerged, &request.metric, request.top_n),
                disappeared: ranked(&disappeared, &request.metric, request.top_n),
            });
        }
        changes.insert(field.into(), deltas);
    }
    Ok(Comparison {
        periods: results,
        common,
        changes,
        excluded,
        sources: selected.into_iter().map(|(_, s)| s).collect(),
    })
}
#[tauri::command]
pub async fn query_traffic_comparison(
    app: AppHandle,
    request: ComparisonRequest,
    request_id: String,
) -> Result<Comparison> {
    let guard = Guard::new(request_id)?;
    tokio::task::spawn_blocking(move || {
        let selected = selection(&app, &request.selection, &guard)?;
        compare(selected, request, &guard)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE vals(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO vals VALUES(0,''),(1,'common'),(2,'first'),(3,'second'),(4,'client'),(5,'404'),(6,'503');CREATE TABLE records(id INTEGER PRIMARY KEY,ts INTEGER,bytes INTEGER,host INTEGER,client INTEGER,category INTEGER,action INTEGER,status INTEGER,application INTEGER,user INTEGER,denied INTEGER,issue_count INTEGER);CREATE TABLE memberships(record_id INTEGER,field INTEGER,value_id INTEGER);").unwrap();
        let hour = 9 * 3_600_000;
        for (id, ts, bytes, host, status, denied) in [
            (1, hour, 100, 2, 5, 0),
            (2, hour + 1_800_000, 100, 2, 0, 1),
            (3, hour + 3_599_000, 1, 1, 0, 0),
            (4, 86_400_000 + hour + 1_800_000, 500, 3, 6, 0),
            (5, 86_400_000 + hour + 3_599_000, 2, 1, 0, 0),
        ] {
            conn.execute(
                "INSERT INTO records VALUES(?1,?2,?3,?4,4,0,0,?5,0,0,?6,0)",
                rusqlite::params![id, ts, bytes, host, status, denied],
            )
            .unwrap();
        }
        conn.execute_batch("PRAGMA query_only=ON").unwrap();
        conn
    }
    fn source(id: &str) -> Source {
        Source {
            id: id.into(),
            source: "fixture".into(),
            scope: None,
            first: None,
            last: None,
            records: 5,
            untimed_records: 0,
            unassigned_diagnostics: 0,
            diagnostics_total: 0,
            field_availability: vec![],
        }
    }
    fn request() -> ComparisonRequest {
        ComparisonRequest {
            selection: Selection {
                capture_ids: vec![],
                scope: TrafficCaptureScope {
                    proxy_identity: "fixture".into(),
                    profile: "mock".into(),
                },
                include_unassigned: true,
            },
            periods: (0..3)
                .map(|d| Period {
                    id: d.to_string(),
                    label: d.to_string(),
                    start: d * 86_400_000 + 9 * 3_600_000,
                    end: d * 86_400_000 + 10 * 3_600_000,
                    ranges: vec![Span {
                        start: d * 86_400_000 + 9 * 3_600_000,
                        end: d * 86_400_000 + 10 * 3_600_000,
                    }],
                })
                .collect(),
            metric: "bytes".into(),
            top_n: 1,
            bucket_seconds: 60,
        }
    }
    #[test]
    fn partial_days_keep_real_totals_and_true_common_sets() {
        let result = compare(
            vec![(fixture(), source("one"))],
            request(),
            &Guard::new("partial-fixture".into()).unwrap(),
        )
        .unwrap();
        assert_eq!(result.periods.len(), 2);
        assert_eq!(result.excluded, 1);
        let first = &result.periods[0];
        let second = &result.periods[1];
        assert_eq!(
            (first.requests, first.bytes, first.http4xx, first.denied),
            (3, 201, 1, 1)
        );
        assert_eq!((second.requests, second.bytes, second.http5xx), (2, 502, 1));
        assert_eq!(second.first, Some(86_400_000 + 9 * 3_600_000 + 1_800_000));
        assert_eq!(second.observed_duration_ms, 1_799_000);
        assert_eq!(first.clients, 1);
        assert_eq!(first.hosts, 2);
        assert_eq!(first.rankings["host"][0].name, "first");
        assert_eq!(result.common["host"][0].name, "common");
        assert_eq!(result.changes["host"][0].emerged[0].name, "second");
        assert_eq!(result.changes["host"][0].disappeared[0].name, "first");
    }
    #[test]
    fn disjoint_dst_ranges_never_include_forbidden_middle() {
        let mut req = request();
        req.periods.truncate(1);
        let p = &mut req.periods[0];
        p.ranges = vec![
            Span {
                start: p.start,
                end: p.start + 900_000,
            },
            Span {
                start: p.start + 2_700_000,
                end: p.end,
            },
        ];
        let result = compare(
            vec![(fixture(), source("one"))],
            req,
            &Guard::new("dst-fixture".into()).unwrap(),
        )
        .unwrap();
        assert_eq!(result.periods[0].requests, 2);
        assert_eq!(result.periods[0].bytes, 101);
        assert_eq!(result.periods[0].observed_duration_ms, 1_799_000);
    }
    #[test]
    fn merged_capture_uniques_are_sets_not_sums() {
        let mut req = request();
        req.periods.truncate(1);
        let result = compare(
            vec![(fixture(), source("one")), (fixture(), source("two"))],
            req,
            &Guard::new("uniques-fixture".into()).unwrap(),
        )
        .unwrap();
        assert_eq!(result.periods[0].requests, 6);
        assert_eq!(result.periods[0].clients, 1);
        assert_eq!(result.periods[0].hosts, 2);
    }
    #[test]
    fn rejects_overlapping_ranges() {
        let mut p = request().periods.remove(0);
        p.ranges.push(Span {
            start: p.start,
            end: p.end,
        });
        assert!(predicate(&p).is_err());
    }
}
