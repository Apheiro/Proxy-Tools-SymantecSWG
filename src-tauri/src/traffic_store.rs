use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::traffic_analysis::{
    AccessLogDataset, AccessLogDiagnostic, AccessLogRecord, TrafficBucket,
};

const VERSION: i64 = 2;
pub(crate) fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("traffic-analysis");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
pub(crate) fn path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !id.starts_with("static-") || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid capture identifier.".into());
    }
    Ok(directory(app)?.join(format!("{id}.sqlite")))
}
fn value<'a>(record: &'a AccessLogRecord, name: &str) -> &'a str {
    record
        .raw_fields
        .get(name)
        .and_then(|v| v.value.as_deref())
        .unwrap_or("")
}
pub(crate) fn epoch(record: &AccessLogRecord) -> Option<i64> {
    record
        .timestamp
        .as_deref()
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
        .map(|d| d.and_utc().timestamp_millis())
}
fn meaningful(s: &str) -> bool {
    !s.is_empty()
        && !matches!(
            s.to_ascii_lowercase().as_str(),
            "none"
                | "unavailable"
                | "-"
                | "0"
                | "false"
                | "clean"
                | "ok"
                | "success"
                | "successful"
                | "no_error"
        )
}

/// Issue signals are explicit; a populated security field is not itself an error.
pub(crate) fn issues(record: &AccessLogRecord) -> Vec<String> {
    let mut result = Vec::new();
    let status = value(record, "sc-status")
        .parse::<u16>()
        .unwrap_or_default();
    let action = value(record, "s-action").to_ascii_uppercase();
    let exception = value(record, "x-exception-id").to_ascii_lowercase();
    if status == 407
        || exception.contains("authentication_failed")
        || exception.contains("auth_failed")
    {
        result.push("Authentication failure".into());
    } else if (400..500).contains(&status) {
        result.push("HTTP client error".into());
    }
    if status >= 500
        || action.contains("FAILED")
        || action.contains("ERROR")
        || action.contains("ERR_")
    {
        result.push("Transaction / server error".into());
    }
    if value(record, "sc-filter-result").eq_ignore_ascii_case("DENIED")
        || action.contains("DENIED")
        || action.contains("BLOCKED")
    {
        result.push("Denied transaction".into());
    }
    let policy = value(record, "x-bluecoat-access-security-policy-action").to_ascii_lowercase();
    if matches!(policy.as_str(), "deny" | "denied" | "block" | "blocked") {
        result.push("Policy denial".into());
    }
    if meaningful(&exception) {
        result.push("Proxy exception".into());
    }
    for (name, field) in &record.raw_fields {
        let key = name.to_ascii_lowercase();
        let val = field.value.as_deref().unwrap_or("").to_ascii_lowercase();
        if !meaningful(&val) {
            continue;
        }
        if (key.contains("certificate") || key.contains("ssl"))
            && (key.contains("error")
                || key.contains("validation")
                || key.contains("status")
                || key.contains("result"))
            && (key.contains("error")
                || val.contains("error")
                || val.contains("failed")
                || val.contains("invalid")
                || val.contains("expired")
                || val.contains("untrusted")
                || val.contains("revoked"))
        {
            result.push("SSL / certificate error".into());
        }
        if key.contains("ocsp")
            && (key.contains("error")
                || val.contains("error")
                || val.contains("failed")
                || val.contains("revoked"))
        {
            result.push("OCSP error".into());
        }
        if key.contains("icap")
            && (val.contains("error") || val.contains("failed") || val.contains("timeout"))
        {
            result.push("ICAP error".into());
        }
        if key == "x-virus-id" {
            result.push("Virus detection".into());
        }
        if key.ends_with("threat-id") {
            result.push("Threat detection".into());
        }
        if key.contains("error")
            && !key.contains("certificate")
            && !key.contains("ssl")
            && !key.contains("ocsp")
            && !key.contains("icap")
        {
            result.push(format!("Reported error: {name}"));
        }
    }
    if exception.contains("ssl") || exception.contains("certificate") || exception.contains("cert_")
    {
        result.push("SSL / certificate error".into());
    }
    if exception.contains("ocsp") {
        result.push("OCSP error".into());
    }
    if exception.contains("icap") {
        result.push("ICAP error".into());
    }
    if record.malformed {
        result.push("Malformed record".into());
    }
    result.sort();
    result.dedup();
    result
}

pub(crate) struct CaptureStore {
    connection: Option<Connection>,
    pub id: String,
    pub file: PathBuf,
}
impl CaptureStore {
    pub(crate) fn create(app: &AppHandle, id: String, source: &str) -> Result<Self, String> {
        let file = path(app, &id)?;
        let connection = Connection::open(&file).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
          CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE records(id INTEGER PRIMARY KEY,ts INTEGER,bytes INTEGER NOT NULL,client TEXT,user TEXT,host TEXT,category TEXT,application TEXT,action TEXT,status TEXT,method TEXT,threat TEXT,search TEXT,issue_count INTEGER,denied INTEGER,record TEXT NOT NULL);
          CREATE INDEX records_time ON records(ts,id);
          CREATE INDEX records_issues_time ON records(ts,id) WHERE issue_count>0;
          CREATE TABLE dimensions(record_id INTEGER,field TEXT,name TEXT,PRIMARY KEY(record_id,field,name));
          CREATE INDEX dimensions_lookup ON dimensions(field,name,record_id);
          CREATE TABLE counters(field TEXT,name TEXT,requests INTEGER,bytes INTEGER,PRIMARY KEY(field,name));
          CREATE TABLE counter_fields(field TEXT PRIMARY KEY,unique_values INTEGER NOT NULL);
          CREATE INDEX counters_requests ON counters(field,requests DESC,name);
          CREATE INDEX counters_bytes ON counters(field,bytes DESC,name);
          CREATE TABLE totals(id INTEGER PRIMARY KEY,requests INTEGER,bytes INTEGER,issues INTEGER,denied INTEGER,first INTEGER,last INTEGER,diagnostics INTEGER);
          INSERT INTO totals VALUES(1,0,0,0,0,NULL,NULL,0);
          CREATE TABLE timeline(epoch INTEGER PRIMARY KEY,requests INTEGER,bytes INTEGER);
          CREATE TABLE diagnostics(id INTEGER PRIMARY KEY,diagnostic TEXT NOT NULL);") .map_err(|e| e.to_string())?;
        for (key, val) in [
            ("version", VERSION.to_string()),
            ("source", source.to_owned()),
            ("saved", "0".into()),
            ("complete", "0".into()),
            ("saved_at", "".into()),
        ] {
            connection
                .execute("INSERT INTO meta VALUES(?1,?2)", params![key, val])
                .map_err(|e| e.to_string())?;
        }
        Ok(Self {
            connection: Some(connection),
            id,
            file,
        })
    }
    pub(crate) fn ingest(
        &mut self,
        records: &[AccessLogRecord],
        diagnostics: &[AccessLogDiagnostic],
    ) -> Result<(), String> {
        let tx = self
            .connection
            .as_mut()
            .ok_or("Capture is closed.")?
            .transaction()
            .map_err(|e| e.to_string())?;
        let mut counters: HashMap<(String, String), (i64, i64)> = HashMap::new();
        let mut timeline: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
        let (mut bytes_sum, mut issue_sum, mut denied_sum) = (0i64, 0i64, 0i64);
        let (mut first, mut last): (Option<i64>, Option<i64>) = (None, None);
        {
            let mut insert = tx.prepare_cached("INSERT INTO records(ts,bytes,client,user,host,category,application,action,status,method,threat,search,issue_count,denied,record) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)").map_err(|e| e.to_string())?;
            let mut dimension = tx
                .prepare_cached("INSERT OR IGNORE INTO dimensions VALUES(?1,?2,?3)")
                .map_err(|e| e.to_string())?;
            for record in records {
                let bytes = ["cs-bytes", "sc-bytes"]
                    .iter()
                    .filter_map(|name| value(record, name).parse::<i64>().ok())
                    .filter(|n| *n >= 0)
                    .sum::<i64>();
                let ts = epoch(record);
                let issue_list = issues(record);
                let denied = i64::from(
                    issue_list
                        .iter()
                        .any(|i| i == "Denied transaction" || i == "Policy denial"),
                );
                let host = value(record, "cs-host");
                let threat = [
                    "cs-threat-risk",
                    "cs-threat-id",
                    "rs-threat-id",
                    "x-virus-id",
                ]
                .map(|name| value(record, name))
                .join(" ");
                let search = record
                    .raw_fields
                    .values()
                    .filter_map(|v| v.value.as_deref())
                    .collect::<Vec<_>>()
                    .join(" ");
                let mut annotated = record.clone();
                annotated.issues = issue_list.clone();
                let issue_count = issue_list.len();
                let json = serde_json::to_string(&annotated).map_err(|e| e.to_string())?;
                insert
                    .execute(params![
                        ts,
                        bytes,
                        value(record, "c-ip"),
                        value(record, "cs-username"),
                        host,
                        value(record, "cs-categories"),
                        value(record, "x-bluecoat-application-name"),
                        value(record, "s-action"),
                        value(record, "sc-status"),
                        value(record, "cs-method"),
                        threat,
                        search,
                        issue_list.len() as i64,
                        denied,
                        json
                    ])
                    .map_err(|e| {
                        format!("Could not persist traffic records (check free disk space): {e}")
                    })?;
                let id = tx.last_insert_rowid();
                let mut dimensions = Vec::new();
                for name in [
                    "c-ip",
                    "cs-username",
                    "cs-host",
                    "cs-categories",
                    "x-bluecoat-application-name",
                    "s-action",
                    "sc-status",
                    "cs-method",
                    "sc-filter-result",
                    "x-bluecoat-access-security-policy-action",
                    "cs-threat-risk",
                ] {
                    let raw = if name == "cs-host" {
                        host
                    } else {
                        value(record, name)
                    };
                    let names: HashSet<_> = if name == "cs-categories" {
                        raw.split(';')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .collect()
                    } else {
                        std::iter::once(raw).filter(|s| !s.is_empty()).collect()
                    };
                    for val in names {
                        dimensions.push((name.to_owned(), val.to_owned()));
                    }
                }
                for issue in issue_list {
                    dimensions.push(("x-issue".into(), issue));
                }
                for (field, name) in dimensions {
                    dimension
                        .execute(params![id, field, name])
                        .map_err(|e| e.to_string())?;
                    let count = counters.entry((field, name)).or_default();
                    count.0 += 1;
                    count.1 += bytes;
                }
                bytes_sum += bytes;
                issue_sum += i64::from(issue_count > 0);
                denied_sum += denied;
                if let Some(ts) = ts {
                    first = Some(first.map_or(ts, |n| n.min(ts)));
                    last = Some(last.map_or(ts, |n| n.max(ts)));
                    let counts = timeline.entry(ts.div_euclid(60000) * 60000).or_default();
                    counts.0 += 1;
                    counts.1 += bytes;
                }
            }
        }
        let mut distinct_updates: HashMap<String, i64> = HashMap::new();
        for ((field, name), (requests, bytes)) in counters {
            // Counts only increase, so returned requests == this batch count
            // means this dimension was first inserted in this transaction.
            let total: i64 = tx.query_row("INSERT INTO counters VALUES(?1,?2,?3,?4) ON CONFLICT(field,name) DO UPDATE SET requests=requests+excluded.requests,bytes=bytes+excluded.bytes RETURNING requests",params![field,name,requests,bytes],|r|r.get(0)).map_err(|e|e.to_string())?;
            if total == requests {
                *distinct_updates.entry(field).or_default() += 1;
            }
        }
        for (field, count) in distinct_updates {
            tx.execute("INSERT INTO counter_fields VALUES(?1,?2) ON CONFLICT(field) DO UPDATE SET unique_values=unique_values+excluded.unique_values",params![field,count]).map_err(|e|e.to_string())?;
        }
        for (epoch, (requests, bytes)) in timeline {
            tx.execute("INSERT INTO timeline VALUES(?1,?2,?3) ON CONFLICT(epoch) DO UPDATE SET requests=requests+excluded.requests,bytes=bytes+excluded.bytes",params![epoch,requests,bytes]).map_err(|e| e.to_string())?;
        }
        tx.execute("UPDATE totals SET requests=requests+?1,bytes=bytes+?2,issues=issues+?3,denied=denied+?4,first=CASE WHEN first IS NULL THEN ?5 WHEN ?5 IS NULL THEN first ELSE MIN(first,?5) END,last=CASE WHEN last IS NULL THEN ?6 WHEN ?6 IS NULL THEN last ELSE MAX(last,?6) END,diagnostics=diagnostics+?7 WHERE id=1",params![records.len() as i64,bytes_sum,issue_sum,denied_sum,first,last,diagnostics.len() as i64]).map_err(|e| e.to_string())?;
        for diagnostic in diagnostics {
            tx.execute(
                "INSERT INTO diagnostics(diagnostic) VALUES(?1)",
                [serde_json::to_string(diagnostic).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
    pub(crate) fn snapshot(&self, dataset: &AccessLogDataset) -> Result<(), String> {
        let mut metadata = dataset.clone();
        metadata.records.clear();
        metadata.diagnostics.clear();
        self.connection.as_ref().ok_or("Capture is closed.")?.execute("INSERT INTO meta VALUES('dataset',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&metadata).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub(crate) fn complete(&self) -> Result<(), String> {
        self.connection
            .as_ref()
            .ok_or("Capture is closed.")?
            .execute("UPDATE meta SET value='1' WHERE key='complete'", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
impl Drop for CaptureStore {
    fn drop(&mut self) {
        let saved = self
            .connection
            .as_ref()
            .and_then(|c| {
                c.query_row("SELECT value FROM meta WHERE key='saved'", [], |r| {
                    r.get::<_, String>(0)
                })
                .ok()
            })
            .is_some_and(|s| s == "1");
        self.connection.take();
        if !saved {
            for suffix in ["", "-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", self.file.display()));
            }
        }
    }
}

fn open(app: &AppHandle, id: &str) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path(app, id)?, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| format!("Could not open traffic capture: {e}"))?;
    conn.busy_timeout(Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    let version: i64 = conn
        .query_row("SELECT value FROM meta WHERE key='version'", [], |r| {
            r.get::<_, String>(0).map(|v| v.parse().unwrap_or(0))
        })
        .map_err(|e| e.to_string())?;
    if version != VERSION {
        return Err("Unsupported indexed capture version.".into());
    }
    Ok(conn)
}
pub(crate) fn dataset(app: &AppHandle, id: &str) -> Result<AccessLogDataset, String> {
    let conn = open(app, id)?;
    let json: String = conn
        .query_row("SELECT value FROM meta WHERE key='dataset'", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let mut dataset: AccessLogDataset = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    dataset.capture_id = Some(id.to_owned());
    Ok(dataset)
}
pub(crate) fn save(app: &AppHandle, id: &str) -> Result<String, String> {
    let conn = open(app, id)?;
    let complete: String = conn
        .query_row("SELECT value FROM meta WHERE key='complete'", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if complete != "1" {
        return Err("Stop the stream or wait for file processing to finish before saving.".into());
    }
    conn.execute_batch("PRAGMA synchronous=FULL;")
        .map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE meta SET value='1' WHERE key='saved'", [])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE meta SET value=?1 WHERE key='saved_at'",
        [Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|e| e.to_string())?;
    Ok(path(app, id)?.display().to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCapture {
    pub id: String,
    pub source: String,
    pub records: usize,
    pub saved_at: String,
    pub path: String,
}
pub(crate) fn list(app: &AppHandle) -> Result<Vec<SavedCapture>, String> {
    let mut captures = Vec::new();
    for entry in std::fs::read_dir(directory(app)?).map_err(|e| e.to_string())? {
        let file = entry.map_err(|e| e.to_string())?.path();
        if file.extension().is_none_or(|e| e != "sqlite") {
            continue;
        }
        let id = file
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let Ok(conn) = open(app, &id) else { continue };
        let saved: String = conn
            .query_row("SELECT value FROM meta WHERE key='saved'", [], |r| r.get(0))
            .unwrap_or_default();
        if saved != "1" {
            continue;
        }
        captures.push(SavedCapture {
            id,
            source: conn
                .query_row("SELECT value FROM meta WHERE key='source'", [], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?,
            records: conn
                .query_row("SELECT requests FROM totals", [], |r| {
                    r.get::<_, i64>(0).map(|v| v as usize)
                })
                .map_err(|e| e.to_string())?,
            saved_at: conn
                .query_row("SELECT value FROM meta WHERE key='saved_at'", [], |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?,
            path: file.display().to_string(),
        });
    }
    Ok(captures)
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrafficQuery {
    pub start: Option<i64>,
    pub end: Option<i64>,
    pub search: String,
    pub client: String,
    pub user: String,
    pub host: String,
    pub threat: String,
    pub method: String,
    pub category: String,
    pub action: String,
    pub status: String,
    pub errors_only: bool,
    pub page: usize,
    pub page_size: usize,
    pub limit: usize,
    pub metric: String,
    pub network_prefix: Option<u8>,
    pub network: String,
    pub network_page: usize,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficSummary {
    requests: i64,
    bytes: i64,
    issues: i64,
    denied: i64,
    unique_users: i64,
    unique_clients: i64,
    unique_destinations: i64,
    first: Option<i64>,
    last: Option<i64>,
    requests_per_second: f64,
    bytes_per_second: f64,
}
#[derive(Clone, Serialize)]
pub struct Ranking {
    name: String,
    value: i64,
    requests: i64,
    bytes: i64,
    percentage: f64,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRanking {
    name: String,
    bytes: i64,
    requests: i64,
    clients: usize,
    percentage: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficQueryResult {
    summary: TrafficSummary,
    rankings: HashMap<String, Vec<Ranking>>,
    network_rankings: Vec<NetworkRanking>,
    network_members: Vec<Ranking>,
    network_member_count: usize,
    timeline: Vec<TrafficBucket>,
    records: Vec<AccessLogRecord>,
    page: usize,
    page_size: usize,
    total_records: i64,
    total_pages: usize,
    diagnostics: Vec<AccessLogDiagnostic>,
    diagnostics_total: i64,
    options: HashMap<String, Vec<String>>,
}

fn conditions(query: &TrafficQuery) -> (String, Vec<rusqlite::types::Value>) {
    let mut sql = Vec::new();
    let mut args = Vec::new();
    for (column, value) in [("ts >=", query.start), ("ts <=", query.end)] {
        if let Some(value) = value {
            sql.push(format!("r.{column} ?"));
            args.push(value.into());
        }
    }
    for (column, value) in [
        ("search", &query.search),
        ("client", &query.client),
        ("user", &query.user),
        ("host", &query.host),
        ("threat", &query.threat),
        ("category", &query.category),
    ] {
        if !value.is_empty() {
            sql.push(format!("r.{column} LIKE ? ESCAPE '\\'"));
            args.push(
                format!(
                    "%{}%",
                    value
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_")
                )
                .into(),
            );
        }
    }
    for (column, value) in [
        ("method", &query.method),
        ("action", &query.action),
        ("status", &query.status),
    ] {
        if !value.is_empty() {
            sql.push(format!("r.{column} = ?"));
            args.push(value.to_owned().into());
        }
    }
    (
        if sql.is_empty() {
            "1=1".into()
        } else {
            sql.join(" AND ")
        },
        args,
    )
}
// Group complete client counters, never the already-truncated Top N ranking.
// IPv6 and missing/invalid client values remain visible in separate buckets.
fn client_network(client: &str, prefix: u8) -> (String, bool) {
    match client.trim().parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            let mask = if prefix == 0 {
                0
            } else {
                u32::MAX << (32 - prefix)
            };
            (
                format!(
                    "{}/{}",
                    std::net::Ipv4Addr::from(u32::from(ip) & mask),
                    prefix
                ),
                true,
            )
        }
        Ok(std::net::IpAddr::V6(_)) => ("IPv6 (not grouped by IPv4 prefix)".into(), true),
        Err(_) => ("Missing / invalid client IP".into(), false),
    }
}

fn network_rankings(
    conn: &Connection,
    query: &TrafficQuery,
    predicate: &str,
    args: &[rusqlite::types::Value],
    summary: &TrafficSummary,
) -> Result<(Vec<NetworkRanking>, Vec<Ranking>, usize), String> {
    let Some(prefix) = query.network_prefix else {
        return Ok((Vec::new(), Vec::new(), 0));
    };
    if prefix > 32 {
        return Err("IPv4 network prefix must be between 0 and 32.".into());
    }
    // Include empty and invalid clients as well as real IPs. Ordering here also
    // makes expanded member pagination deterministic and bounded in memory.
    let (sql, parameters) = if predicate == "1=1" {
        (
            "SELECT name,requests,bytes FROM counters WHERE field='c-ip' ORDER BY bytes DESC,name"
                .to_owned(),
            Vec::new(),
        )
    } else {
        (format!("SELECT COALESCE(client,''),COUNT(*),COALESCE(SUM(bytes),0) AS traffic FROM records r WHERE {predicate} GROUP BY client ORDER BY traffic DESC,client"), args.to_vec())
    };
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params_from_iter(parameters.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut groups: HashMap<String, NetworkRanking> = HashMap::new();
    let mut members = Vec::new();
    let mut member_count = 0_usize;
    let offset = query
        .network_page
        .max(1)
        .saturating_sub(1)
        .saturating_mul(50);
    let mut accounted_requests = 0;
    let mut accounted_bytes = 0;
    for row in rows {
        let (client, requests, bytes) = row.map_err(|e| e.to_string())?;
        accounted_requests += requests;
        accounted_bytes += bytes;
        let (name, valid) = client_network(&client, prefix);
        let group = groups
            .entry(name.clone())
            .or_insert_with(|| NetworkRanking {
                name: name.clone(),
                ..Default::default()
            });
        group.requests += requests;
        group.bytes += bytes;
        group.clients += usize::from(valid);
        if query.network == name {
            if member_count >= offset && members.len() < 50 {
                members.push(Ranking {
                    name: if client.is_empty() {
                        "(missing)".into()
                    } else {
                        client
                    },
                    value: bytes,
                    requests,
                    bytes,
                    percentage: 0.,
                });
            }
            member_count += 1;
        }
    }
    // Empty client fields are excluded from the persisted dimension counters.
    if predicate == "1=1" && accounted_requests < summary.requests {
        let name = "Missing / invalid client IP".to_owned();
        let group = groups
            .entry(name.clone())
            .or_insert_with(|| NetworkRanking {
                name: name.clone(),
                ..Default::default()
            });
        let bytes = summary.bytes - accounted_bytes;
        let requests = summary.requests - accounted_requests;
        group.bytes += bytes;
        group.requests += requests;
    }
    if let Some(group) = groups.get(&query.network) {
        for member in &mut members {
            member.percentage = if group.bytes > 0 {
                member.bytes as f64 * 100. / group.bytes as f64
            } else {
                0.
            };
        }
    }
    let mut groups: Vec<_> = groups.into_values().collect();
    for group in &mut groups {
        group.percentage = if summary.bytes > 0 {
            group.bytes as f64 * 100. / summary.bytes as f64
        } else {
            0.
        };
    }
    groups.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    groups.truncate(query.limit.clamp(1, 50));
    Ok((groups, members, member_count))
}

// A bounded revision-aware cache reuses range analytics across pagination.
// No raw record pages are retained here; ingestion invalidates by persisted counts.
static ANALYTICS_CACHE: OnceLock<Mutex<VecDeque<(String, TrafficQueryResult)>>> = OnceLock::new();

fn query_capture(
    app: &AppHandle,
    id: &str,
    query: TrafficQuery,
) -> Result<TrafficQueryResult, String> {
    if query.start.zip(query.end).is_some_and(|(a, b)| a > b) {
        return Err("The range start must not be after its end.".into());
    }
    let conn = open(app, id)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (predicate, args) = conditions(&query);
    let global = predicate == "1=1";
    let revision: (i64, i64) = tx
        .query_row("SELECT requests,diagnostics FROM totals", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut selection = serde_json::to_value(&query).map_err(|e| e.to_string())?;
    if let Some(object) = selection.as_object_mut() {
        for key in ["page", "pageSize", "errorsOnly"] {
            object.remove(key);
        }
    }
    let cache_key = format!(
        "{}:{}:{}:{}",
        path(app, id)?.display(),
        revision.0,
        revision.1,
        selection
    );
    let cache = ANALYTICS_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    if !global {
        let cached = cache
            .lock()
            .map_err(|_| "Analytics cache is unavailable.")?
            .iter()
            .find(|(key, _)| key == &cache_key)
            .map(|(_, result)| result.clone());
        if let Some(result) = cached {
            return page_result(&tx, &query, &predicate, &args, result);
        }
    }
    let summary_sql = if global {
        "SELECT requests,bytes,issues,denied,first,last,COALESCE((SELECT unique_values FROM counter_fields WHERE field='cs-username'),0),COALESCE((SELECT unique_values FROM counter_fields WHERE field='c-ip'),0),COALESCE((SELECT unique_values FROM counter_fields WHERE field='cs-host'),0) FROM totals".into()
    } else {
        format!("SELECT COUNT(*),COALESCE(SUM(bytes),0),COALESCE(SUM(issue_count>0),0),COALESCE(SUM(denied),0),MIN(ts),MAX(ts),COUNT(DISTINCT NULLIF(user,'')),COUNT(DISTINCT NULLIF(client,'')),COUNT(DISTINCT NULLIF(host,'')) FROM records r WHERE {predicate}")
    };
    let mut summary = tx
        .query_row(&summary_sql, params_from_iter(args.iter()), |r| {
            Ok(TrafficSummary {
                requests: r.get(0)?,
                bytes: r.get(1)?,
                issues: r.get(2)?,
                denied: r.get(3)?,
                first: r.get(4)?,
                last: r.get(5)?,
                unique_users: r.get(6)?,
                unique_clients: r.get(7)?,
                unique_destinations: r.get(8)?,
                ..TrafficSummary::default()
            })
        })
        .map_err(|e| e.to_string())?;
    let duration = match (summary.first, summary.last) {
        (Some(first), Some(last)) => {
            ((query.end.unwrap_or(last) - query.start.unwrap_or(first)) as f64 / 1000.).max(1.)
        }
        _ => 1.,
    };
    summary.requests_per_second = summary.requests as f64 / duration;
    summary.bytes_per_second = summary.bytes as f64 / duration;
    let mut rankings: HashMap<String, Vec<Ranking>> = HashMap::new();
    let mut options: HashMap<String, Vec<String>> = HashMap::new();
    let mut range_rankings: HashMap<String, Vec<(String, i64, i64)>> = HashMap::new();
    let top = query.limit.clamp(1, 50) as i64;
    if !global {
        // Materialize the timestamp/filter selection once. The dimension primary
        // key starts with record_id, so every selected row joins its memberships.
        let order = if query.metric == "bytes" {
            "CASE WHEN field='x-issue' THEN requests ELSE bytes END"
        } else {
            "requests"
        };
        let sql = format!("WITH selected AS MATERIALIZED (SELECT r.id,r.bytes FROM records r WHERE {predicate}), counts AS (SELECT d.field,d.name,COUNT(*) AS requests,COALESCE(SUM(r.bytes),0) AS bytes FROM selected r JOIN dimensions d ON d.record_id=r.id GROUP BY d.field,d.name), ordered AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY field ORDER BY {order} DESC,name) AS position FROM counts) SELECT field,name,requests,bytes FROM ordered WHERE position<=? ORDER BY field,position");
        let mut parameters = args.clone();
        parameters.push(top.into());
        let mut statement = tx.prepare(&sql).map_err(|e| e.to_string())?;
        for row in statement
            .query_map(params_from_iter(parameters.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?
        {
            let (field, name, requests, bytes) = row.map_err(|e| e.to_string())?;
            range_rankings
                .entry(field)
                .or_default()
                .push((name, requests, bytes));
        }
    }
    for field in [
        "c-ip",
        "cs-username",
        "cs-host",
        "cs-categories",
        "x-bluecoat-application-name",
        "s-action",
        "sc-status",
        "cs-method",
        "sc-filter-result",
        "x-bluecoat-access-security-policy-action",
        "cs-threat-risk",
        "x-issue",
    ] {
        let by_bytes = query.metric == "bytes" && field != "x-issue";
        let metric = if by_bytes { "bytes" } else { "requests" };
        let rows = if global {
            let sql=format!("SELECT name,requests,bytes FROM counters WHERE field=? ORDER BY {metric} DESC,name LIMIT ?");
            let mut statement = tx.prepare(&sql).map_err(|e| e.to_string())?;
            let result = statement
                .query_map(params![field, top], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            result
        } else {
            range_rankings.remove(field).unwrap_or_default()
        };
        let mut items = Vec::new();
        for (name, requests, bytes) in rows {
            let value = if by_bytes { bytes } else { requests };
            let total = if by_bytes {
                summary.bytes
            } else {
                summary.requests
            };
            items.push(Ranking {
                name,
                value,
                requests,
                bytes,
                percentage: if total == 0 {
                    0.
                } else {
                    value as f64 * 100. / total as f64
                },
            });
        }
        rankings.insert(field.to_owned(), items);
    }
    let mut statement=tx.prepare("SELECT field,name FROM counters WHERE field IN ('cs-categories','s-action','sc-status','cs-method') ORDER BY name").map_err(|e|e.to_string())?;
    for row in statement
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
    {
        let (field, name) = row.map_err(|e| e.to_string())?;
        options.entry(field).or_default().push(name);
    }
    let sql = if global {
        "SELECT epoch,requests,bytes FROM timeline ORDER BY epoch".into()
    } else {
        format!("SELECT (ts/60000)*60000,COUNT(*),COALESCE(SUM(bytes),0) FROM records r WHERE {predicate} AND ts IS NOT NULL GROUP BY (ts/60000) ORDER BY 1")
    };
    let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
    let timeline = stmt
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(TrafficBucket {
                epoch: r.get(0)?,
                requests: r.get::<_, i64>(1)? as usize,
                bytes: r.get::<_, i64>(2)? as u64,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let diagnostics_total = tx
        .query_row("SELECT diagnostics FROM totals", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut stmt = tx
        .prepare("SELECT diagnostic FROM diagnostics ORDER BY id DESC LIMIT 100")
        .map_err(|e| e.to_string())?;
    let mut diagnostics = Vec::new();
    for row in stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        diagnostics.push(
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        );
    }
    let (network_rankings, network_members, network_member_count) =
        network_rankings(&tx, &query, &predicate, &args, &summary)?;
    let result = TrafficQueryResult {
        network_rankings,
        network_members,
        network_member_count,
        summary,
        rankings,
        timeline,
        records: Vec::new(),
        page: 1,
        page_size: 0,
        total_records: 0,
        total_pages: 1,
        diagnostics,
        diagnostics_total,
        options,
    };
    if !global
        && result.timeline.len() <= 100_000
        && result
            .diagnostics
            .iter()
            .map(|d| d.raw_line.len())
            .sum::<usize>()
            < 4 * 1024 * 1024
    {
        let mut entries = cache
            .lock()
            .map_err(|_| "Analytics cache is unavailable.")?;
        entries.retain(|(key, _)| key != &cache_key);
        entries.push_front((cache_key, result.clone()));
        while entries.len() > 4 {
            entries.pop_back();
        }
    }
    page_result(&tx, &query, &predicate, &args, result)
}
#[tauri::command]
pub async fn query_traffic_capture(
    app: AppHandle,
    capture_id: String,
    query: TrafficQuery,
) -> Result<TrafficQueryResult, String> {
    tokio::task::spawn_blocking(move || query_capture(&app, &capture_id, query))
        .await
        .map_err(|e| e.to_string())?
}

fn page_result(
    tx: &rusqlite::Transaction<'_>,
    query: &TrafficQuery,
    predicate: &str,
    args: &[rusqlite::types::Value],
    mut result: TrafficQueryResult,
) -> Result<TrafficQueryResult, String> {
    let total_records = if query.errors_only {
        result.summary.issues
    } else {
        result.summary.requests
    };
    let size = query.page_size.clamp(1, 500);
    let total_pages = (total_records as usize).div_ceil(size).max(1);
    let page = query.page.max(1).min(total_pages);
    let mut record_args = args.to_vec();
    record_args.push((size as i64).into());
    record_args.push(
        ((page - 1) * size)
            .try_into()
            .map(rusqlite::types::Value::Integer)
            .map_err(|_| "Page offset exceeds supported size.")?,
    );
    let sql = format!(
        "SELECT record FROM records r WHERE {predicate} {} ORDER BY r.ts,r.id LIMIT ? OFFSET ?",
        if query.errors_only {
            "AND issue_count>0"
        } else {
            ""
        }
    );
    let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
    let raw = stmt
        .query_map(params_from_iter(record_args.iter()), |r| {
            r.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    for row in raw {
        records.push(
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        );
    }

    result.records = records;
    result.page = page;
    result.page_size = size;
    result.total_records = total_records;
    result.total_pages = total_pages;
    Ok(result)
}
