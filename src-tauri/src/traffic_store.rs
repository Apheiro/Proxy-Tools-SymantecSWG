use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::traffic_analysis::{
    AccessLogDataset, AccessLogDiagnostic, AccessLogRecord, TrafficBucket,
};

const VERSION: i64 = 3;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrafficCaptureScope {
    pub proxy_identity: String,
    pub profile: String,
}

impl TrafficCaptureScope {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.proxy_identity.trim().is_empty()
            || !matches!(self.profile.as_str(), "live" | "mock")
        {
            return Err("Select a proxy and a valid data profile for this capture.".into());
        }
        Ok(())
    }
}

fn read_scope(conn: &Connection) -> Result<Option<TrafficCaptureScope>, String> {
    use rusqlite::OptionalExtension;
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='capture_scope'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    json.map(|value| {
        let scope: TrafficCaptureScope = serde_json::from_str(&value).map_err(|e| e.to_string())?;
        scope.validate()?;
        Ok(scope)
    })
    .transpose()
}

pub(crate) fn capture_scope(
    app: &AppHandle,
    id: &str,
) -> Result<Option<TrafficCaptureScope>, String> {
    read_scope(&open(app, id)?)
}
fn is_v3(conn: &Connection) -> bool {
    conn.query_row("SELECT value FROM meta WHERE key='version'", [], |r| {
        r.get::<_, String>(0)
    })
    .is_ok_and(|v| v == "3")
}
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
/// These rules define v3 projection version 1; evolve the version instead of reclassifying history silently.
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
    pub(crate) fn set_scope(&self, scope: &TrafficCaptureScope) -> Result<(), String> {
        scope.validate()?;
        self.connection
            .as_ref()
            .ok_or("Capture is closed.")?
            .execute(
                "INSERT INTO meta(key,value) VALUES('capture_scope',?)",
                [serde_json::to_string(scope).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub(crate) fn create(app: &AppHandle, id: String, source: &str) -> Result<Self, String> {
        let file = path(app, &id)?;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
            .map_err(|e| format!("Cannot create a new capture: {e}"))?;
        let connection = Connection::open(&file).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(|e| e.to_string())?;
        crate::traffic_store_v3::create(&connection)?;
        for (key, val) in [
            ("version", VERSION.to_string()),
            ("token_codec", "1".into()),
            ("interpretation", "1".into()),
            ("projection", "1".into()),
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
        crate::traffic_store_v3::ingest(
            self.connection.as_mut().ok_or("Capture is closed.")?,
            records,
            diagnostics,
        )
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

pub(crate) fn open(app: &AppHandle, id: &str) -> Result<Connection, String> {
    open_file(&path(app, id)?)
}
fn open_file(file: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open traffic capture: {e}"))?;
    conn.busy_timeout(Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    let version: i64 = conn
        .query_row("SELECT value FROM meta WHERE key='version'", [], |r| {
            r.get::<_, String>(0).map(|v| v.parse().unwrap_or(0))
        })
        .map_err(|e| e.to_string())?;
    if version != 2 && version != VERSION {
        return Err("Unsupported indexed capture version.".into());
    }
    if version == 3 {
        for key in ["token_codec", "interpretation", "projection"] {
            let value: String = conn
                .query_row("SELECT value FROM meta WHERE key=?", [key], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if value != "1" {
                return Err(format!("Unsupported traffic {key} version: {value}"));
            }
        }
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
    let checked = open(app, id)?;
    drop(checked);
    let conn = Connection::open_with_flags(path(app, id)?, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
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
    pub scope: Option<TrafficCaptureScope>,
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
            scope: read_scope(&conn)?,
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
    pub compact_records: bool,
    pub omit_records: bool,
    pub page: usize,
    pub page_size: usize,
    pub limit: usize,
    pub ranking_pages: HashMap<String, usize>,
    pub metric: String,
    pub network_prefix: Option<u8>,
    pub network: String,
    pub network_page: usize,
    pub network_list_page: usize,
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
    ranking_counts: HashMap<String, usize>,
    network_rankings: Vec<NetworkRanking>,
    network_members: Vec<Ranking>,
    network_member_count: usize,
    network_count: usize,
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

fn conditions(query: &TrafficQuery, v3: bool) -> (String, Vec<rusqlite::types::Value>) {
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
            if v3 {
                if column == "search" || column == "threat" {
                    sql.push(format!("(SELECT {}(c.tokens,s.fields,c.exception) FROM canonical c JOIN schemas s ON s.id=c.schema_id WHERE c.id=r.id) LIKE ? ESCAPE '\\'",if column=="search" {"traffic_search"}else{"traffic_threat"}));
                } else {
                    sql.push(format!(
                        "r.{column} IN (SELECT id FROM vals WHERE name LIKE ? ESCAPE '\\')"
                    ));
                }
            } else {
                sql.push(format!("r.{column} LIKE ? ESCAPE '\\'"));
            }
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
            sql.push(if v3 {
                format!("r.{column} = (SELECT id FROM vals WHERE name=?)")
            } else {
                format!("r.{column} = ?")
            });
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
) -> Result<(Vec<NetworkRanking>, Vec<Ranking>, usize, usize), String> {
    let Some(prefix) = query.network_prefix else {
        return Ok((Vec::new(), Vec::new(), 0, 0));
    };
    if prefix > 32 {
        return Err("IPv4 network prefix must be between 0 and 32.".into());
    }
    // Include empty and invalid clients as well as real IPs. Ordering here also
    // makes expanded member pagination deterministic and bounded in memory.
    let by_bytes = query.metric == "bytes";
    let metric = if by_bytes { "bytes" } else { "requests" };
    let range_order = if by_bytes { "traffic" } else { "COUNT(*)" };
    let (sql, parameters) = if predicate == "1=1" {
        (
            format!("SELECT name,requests,bytes FROM counters WHERE field='c-ip' ORDER BY {metric} DESC,name"),
            Vec::new(),
        )
    } else {
        (
            if is_v3(conn) {
                format!("SELECT v.name,g.requests,g.traffic FROM (SELECT client,COUNT(*) AS requests,COALESCE(SUM(bytes),0) AS traffic FROM records r WHERE {predicate} GROUP BY client) g JOIN vals v ON v.id=g.client ORDER BY {} DESC,v.name",if by_bytes {"g.traffic"}else{"g.requests"})
            } else {
                format!("SELECT COALESCE(client,''),COUNT(*),COALESCE(SUM(bytes),0) AS traffic FROM records r WHERE {predicate} GROUP BY client ORDER BY {range_order} DESC,client")
            },
            args.to_vec(),
        )
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
                    value: if by_bytes { bytes } else { requests },
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
            let total = if by_bytes {
                group.bytes
            } else {
                group.requests
            };
            member.percentage = if total > 0 {
                member.value as f64 * 100. / total as f64
            } else {
                0.
            };
        }
    }
    let mut groups: Vec<_> = groups.into_values().collect();
    for group in &mut groups {
        let total = if by_bytes {
            summary.bytes
        } else {
            summary.requests
        };
        let value = if by_bytes {
            group.bytes
        } else {
            group.requests
        };
        group.percentage = if total > 0 {
            value as f64 * 100. / total as f64
        } else {
            0.
        };
    }
    groups.sort_by(|a, b| {
        let a_value = if by_bytes { a.bytes } else { a.requests };
        let b_value = if by_bytes { b.bytes } else { b.requests };
        b_value.cmp(&a_value).then_with(|| a.name.cmp(&b.name))
    });
    let network_count = groups.len();
    let last_page = network_count.div_ceil(50).max(1);
    let offset = (query.network_list_page.max(1).min(last_page) - 1) * 50;
    let groups = groups.into_iter().skip(offset).take(50).collect();
    Ok((groups, members, member_count, network_count))
}

// A bounded revision-aware cache reuses range analytics across pagination.
// No raw record pages are retained here; ingestion invalidates by persisted counts.
static ANALYTICS_CACHE: OnceLock<Mutex<VecDeque<(String, TrafficQueryResult)>>> = OnceLock::new();

type Counts = HashMap<String, Vec<(String, i64, i64)>>;
// Full unpaginated aggregates are reusable across ranking pages and metrics.
// Admission is bounded by estimated owned bytes, not just an entry count.
static LARGE_RANGES: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
static RANGE_CACHE: OnceLock<Mutex<VecDeque<(String, Arc<Counts>, usize)>>> = OnceLock::new();
const RANGE_CACHE_BYTES: usize = 16 * 1024 * 1024;
struct ScopeAnalytics {
    summary: TrafficSummary,
    timeline: Vec<TrafficBucket>,
}
static SCOPE_CACHE: OnceLock<Mutex<VecDeque<(String, Arc<ScopeAnalytics>, usize)>>> =
    OnceLock::new();
const SCOPE_CACHE_BYTES: usize = 4 * 1024 * 1024;
fn cache_scope(
    key: &str,
    summary: TrafficSummary,
    timeline: Vec<TrafficBucket>,
) -> Result<(), String> {
    let bytes = timeline.len() * std::mem::size_of::<TrafficBucket>() + 256;
    if bytes <= SCOPE_CACHE_BYTES {
        let mut entries = SCOPE_CACHE
            .get_or_init(|| Mutex::new(VecDeque::new()))
            .lock()
            .map_err(|e| e.to_string())?;
        entries.retain(|(k, _, _)| k != key);
        while entries.iter().map(|(_, _, b)| b).sum::<usize>() + bytes > SCOPE_CACHE_BYTES
            || entries.len() >= 4
        {
            entries.pop_back();
        }
        entries.push_front((
            key.into(),
            Arc::new(ScopeAnalytics { summary, timeline }),
            bytes,
        ));
    }
    Ok(())
}
fn v3_counts_sql(predicate: &str) -> String {
    let mut groups = Vec::new();
    for (field, column) in crate::traffic_store_v3::FIELDS {
        groups.push(format!("SELECT '{field}' AS field,{column} AS value_id,COUNT(*) AS requests,SUM(bytes) AS bytes FROM selected WHERE {column}<>0 GROUP BY {column}"));
    }
    groups.push("SELECT CASE m.field WHEN 0 THEN 'cs-categories' ELSE 'x-issue' END,m.value_id,COUNT(*),SUM(r.bytes) FROM selected r JOIN memberships m ON m.record_id=r.id GROUP BY m.field,m.value_id".into());
    format!("WITH selected AS MATERIALIZED (SELECT r.* FROM records r WHERE {predicate}), grouped AS ({}) SELECT g.field,v.name,g.requests,g.bytes FROM grouped g JOIN vals v ON v.id=g.value_id",groups.join(" UNION ALL "))
}
fn range_counts(
    conn: &Connection,
    predicate: &str,
    args: &[rusqlite::types::Value],
    key: &str,
) -> Result<Option<Arc<Counts>>, String> {
    let profile = std::env::var_os("TRAFFIC_QUERY_PROFILE").is_some();
    let large = LARGE_RANGES.get_or_init(|| Mutex::new(VecDeque::new()));
    if large
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|k| k == key)
    {
        if profile {
            eprintln!("traffic_profile range_cache=known_oversize");
        }
        return Ok(None);
    }
    let cache = RANGE_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Some((_, rows, _)) = cache
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|(k, _, _)| k == key)
    {
        if std::env::var_os("TRAFFIC_QUERY_PROFILE").is_some() {
            eprintln!("traffic_profile range_cache=hit");
        }
        return Ok(Some(Arc::clone(rows)));
    }
    // Aggregate integer facts in one pass, rather than sorting the selected rows ten times.
    let columns = crate::traffic_store_v3::FIELDS
        .iter()
        .map(|(_, column)| format!("r.{column}"))
        .collect::<Vec<_>>()
        .join(",");
    let mut summary = TrafficSummary::default();
    let mut minute_counts: BTreeMap<i64, (usize, u64)> = BTreeMap::new();
    let mut numeric: HashMap<(usize, i64), (i64, i64)> = HashMap::new();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT r.bytes,{columns},r.ts,r.issue_count,r.denied FROM records r WHERE {predicate}"
        ))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params_from_iter(args.iter()))
        .map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let traffic: i64 = row.get(0).map_err(|e| e.to_string())?;
        summary.requests += 1;
        summary.bytes = summary
            .bytes
            .checked_add(traffic)
            .ok_or("Traffic byte total overflow")?;
        summary.issues += i64::from(row.get::<_, i64>(12).map_err(|e| e.to_string())? > 0);
        summary.denied += row.get::<_, i64>(13).map_err(|e| e.to_string())?;
        if let Some(ts) = row.get::<_, Option<i64>>(11).map_err(|e| e.to_string())? {
            summary.first = Some(summary.first.map_or(ts, |n| n.min(ts)));
            summary.last = Some(summary.last.map_or(ts, |n| n.max(ts)));
            let counts = minute_counts
                .entry(ts.div_euclid(60000) * 60000)
                .or_default();
            counts.0 += 1;
            counts.1 += traffic as u64;
        }

        for index in 0..crate::traffic_store_v3::FIELDS.len() {
            let id: i64 = row.get(index + 1).map_err(|e| e.to_string())?;
            if id != 0 {
                let counts = numeric.entry((index, id)).or_default();
                counts.0 += 1;
                counts.1 += traffic;
            }
        }
        if numeric.len() * 128 > RANGE_CACHE_BYTES {
            break;
        }
    }
    drop(rows);
    if numeric.len() * 128 <= RANGE_CACHE_BYTES {
        summary.unique_clients = numeric.keys().filter(|(field, _)| *field == 0).count() as i64;
        summary.unique_users = numeric.keys().filter(|(field, _)| *field == 1).count() as i64;
        summary.unique_destinations =
            numeric.keys().filter(|(field, _)| *field == 2).count() as i64;
        let timeline = minute_counts
            .into_iter()
            .map(|(epoch, (requests, bytes))| TrafficBucket {
                epoch,
                requests,
                bytes,
            })
            .collect();
        cache_scope(key, summary, timeline)?;
        let mut stmt=conn.prepare(&format!("SELECT m.field,m.value_id,r.bytes FROM records r CROSS JOIN memberships m ON m.record_id=r.id WHERE {predicate}")).map_err(|e|e.to_string())?;
        let mut rows = stmt
            .query(params_from_iter(args.iter()))
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let field: u8 = row.get(0).map_err(|e| e.to_string())?;
            let id: i64 = row.get(1).map_err(|e| e.to_string())?;
            let traffic: i64 = row.get(2).map_err(|e| e.to_string())?;
            let counts = numeric.entry((10 + usize::from(field), id)).or_default();
            counts.0 += 1;
            counts.1 += traffic;
            if numeric.len() * 128 > RANGE_CACHE_BYTES {
                break;
            }
        }
    }
    if numeric.len() * 128 > RANGE_CACHE_BYTES {
        if profile {
            eprintln!(
                "traffic_profile range_cache=rejected groups={} budget={RANGE_CACHE_BYTES}",
                numeric.len()
            );
        }
        let mut entries = large.lock().map_err(|e| e.to_string())?;
        entries.push_front(key.into());
        while entries.len() > 16 {
            entries.pop_back();
        }
        return Ok(None);
    }
    let ids: std::collections::HashSet<i64> = numeric.keys().map(|(_, id)| *id).collect();
    let ids = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id,name FROM vals WHERE id IN (SELECT value FROM json_each(?))")
        .map_err(|e| e.to_string())?;
    let names: HashMap<i64, String> = stmt
        .query_map([ids], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let mut grouped: Counts = HashMap::new();
    let mut bytes = 0;
    for ((field, id), (requests, traffic)) in numeric {
        let field = if field < 10 {
            crate::traffic_store_v3::FIELDS[field].0
        } else if field == 10 {
            "cs-categories"
        } else {
            "x-issue"
        };
        let name = names
            .get(&id)
            .ok_or("Missing traffic dimension value")?
            .clone();
        bytes += name.len() + 128;
        grouped
            .entry(field.into())
            .or_default()
            .push((name, requests, traffic));
    }
    if bytes > RANGE_CACHE_BYTES {
        return Ok(Some(Arc::new(grouped)));
    } // Return correctly, but don't retain an oversize entry.
    if profile {
        eprintln!(
            "traffic_profile range_cache=admitted estimated_bytes={bytes} groups={}",
            grouped.values().map(Vec::len).sum::<usize>()
        );
    }
    let grouped = Arc::new(grouped);
    let mut entries = cache.lock().map_err(|e| e.to_string())?;
    entries.retain(|(k, _, _)| k != key);
    while entries.iter().map(|(_, _, b)| b).sum::<usize>() + bytes > RANGE_CACHE_BYTES
        || entries.len() >= 4
    {
        entries.pop_back();
    }
    entries.push_front((key.into(), Arc::clone(&grouped), bytes));
    Ok(Some(grouped))
}

static SEARCH_CACHE: OnceLock<Mutex<VecDeque<(String, Arc<Vec<i64>>, usize)>>> = OnceLock::new();
const SEARCH_CACHE_BYTES: usize = 4 * 1024 * 1024;
fn prepare_matches(
    conn: &Connection,
    predicate: &str,
    args: &[rusqlite::types::Value],
    key: &str,
) -> Result<(), String> {
    let cache = SEARCH_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    let cached = cache
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|(k, _, _)| k == key)
        .map(|(_, ids, _)| Arc::clone(ids));
    conn.execute_batch("DROP TABLE IF EXISTS temp.traffic_matches;CREATE TEMP TABLE traffic_matches(id INTEGER PRIMARY KEY)").map_err(|e|e.to_string())?;
    if let Some(ids) = cached {
        conn.execute(
            "INSERT INTO traffic_matches SELECT value FROM json_each(?)",
            [serde_json::to_string(&*ids).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        if std::env::var_os("TRAFFIC_QUERY_PROFILE").is_some() {
            eprintln!("traffic_profile search_ids_cache=hit rows={}", ids.len());
        }
    } else {
        conn.execute(
            &format!("INSERT INTO traffic_matches SELECT r.id FROM records r WHERE {predicate}"),
            params_from_iter(args.iter()),
        )
        .map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM traffic_matches", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let bytes = count as usize * 16 + 128;
        if bytes <= SEARCH_CACHE_BYTES {
            let mut stmt = conn
                .prepare("SELECT id FROM traffic_matches ORDER BY id")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map([], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            let mut entries = cache.lock().map_err(|e| e.to_string())?;
            entries.retain(|(k, _, _)| k != key);
            while entries.iter().map(|(_, _, b)| b).sum::<usize>() + bytes > SEARCH_CACHE_BYTES
                || entries.len() >= 4
            {
                entries.pop_back();
            }
            entries.push_front((key.into(), Arc::new(ids), bytes));
        }
    }
    Ok(())
}
fn filter_options(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let mut options: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt=conn.prepare("SELECT field,name FROM counters WHERE field IN ('cs-categories','s-action','sc-status','cs-method') ORDER BY name").map_err(|e|e.to_string())?;
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
    {
        let (field, name) = row.map_err(|e| e.to_string())?;
        options.entry(field).or_default().push(name);
    }
    Ok(options)
}
fn query_connection(
    conn: &Connection,
    cache_identity: &str,
    query: TrafficQuery,
) -> Result<TrafficQueryResult, String> {
    let profile = std::env::var_os("TRAFFIC_QUERY_PROFILE").is_some();
    let started = std::time::Instant::now();
    if query.start.zip(query.end).is_some_and(|(a, b)| a > b) {
        return Err("The range start must not be after its end.".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let v3 = is_v3(&tx);
    if v3 && (!query.search.is_empty() || !query.threat.is_empty()) {
        crate::traffic_store_v3::register_search(&tx)?;
    }
    let (mut predicate, mut args) = conditions(&query, v3);
    let global = predicate == "1=1";
    let revision: (i64, i64) = tx
        .query_row("SELECT requests,diagnostics FROM totals", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|e| e.to_string())?;
    let revision = if query.start.is_some() || query.end.is_some() {
        let first = query
            .start
            .map(|n| n.div_euclid(60000) * 60000)
            .unwrap_or(i64::MIN);
        let last = query
            .end
            .map(|n| n.div_euclid(60000) * 60000)
            .unwrap_or(i64::MAX);
        let requests = tx
            .query_row(
                "SELECT COALESCE(SUM(requests),0) FROM timeline WHERE epoch>=? AND epoch<=?",
                params![first, last],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        (requests, revision.1)
    } else {
        revision
    };
    let mut selection = serde_json::to_value(&query).map_err(|e| e.to_string())?;
    if let Some(object) = selection.as_object_mut() {
        for key in [
            "page",
            "pageSize",
            "errorsOnly",
            "compactRecords",
            "omitRecords",
        ] {
            object.remove(key);
        }
    }
    let cache_key = format!(
        "{}:{}:{}:{}",
        cache_identity, revision.0, revision.1, selection
    );
    let mut range_selection = selection.clone();
    if let Some(object) = range_selection.as_object_mut() {
        for key in [
            "rankingPages",
            "metric",
            "limit",
            "networkPrefix",
            "network",
            "networkPage",
            "networkListPage",
        ] {
            object.remove(key);
        }
    }
    let range_key = format!("{cache_identity}:{}:{range_selection}", revision.0);
    let cache = ANALYTICS_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    if !global {
        let cached = cache
            .lock()
            .map_err(|_| "Analytics cache is unavailable.")?
            .iter()
            .find(|(key, _)| key == &cache_key)
            .map(|(_, result)| result.clone());
        if let Some(mut result) = cached {
            result.options = filter_options(&tx)?;
            if v3 && !query.omit_records && (!query.search.is_empty() || !query.threat.is_empty()) {
                prepare_matches(&tx, &predicate, &args, &range_key)?;
                predicate = "r.id IN (SELECT id FROM traffic_matches)".into();
                args.clear();
            }
            return page_result(&tx, &query, &predicate, &args, result);
        }
    }
    let scope_cache = SCOPE_CACHE.get_or_init(|| Mutex::new(VecDeque::new()));
    let mut scope = scope_cache
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .find(|(key, _, _)| key == &range_key)
        .map(|(_, value, _)| Arc::clone(value));
    if v3 && (!query.search.is_empty() || !query.threat.is_empty()) {
        let t = std::time::Instant::now();
        prepare_matches(&tx, &predicate, &args, &range_key)?;
        predicate = "r.id IN (SELECT id FROM traffic_matches)".into();
        args.clear();
        if profile {
            eprintln!(
                "traffic_profile search_selection_ms={}",
                t.elapsed().as_millis()
            );
        }
    }
    let precounted = if v3 && !global {
        let t = std::time::Instant::now();
        let counts = range_counts(&tx, &predicate, &args, &range_key)?;
        if profile {
            eprintln!(
                "traffic_profile selection_aggregate_ms={}",
                t.elapsed().as_millis()
            );
        }
        if scope.is_none() {
            scope = scope_cache
                .lock()
                .map_err(|e| e.to_string())?
                .iter()
                .find(|(key, _, _)| key == &range_key)
                .map(|(_, value, _)| Arc::clone(value));
        }
        counts
    } else {
        None
    };
    let summary_started = std::time::Instant::now();
    let summary_sql = if global {
        "SELECT requests,bytes,issues,denied,first,last,COALESCE((SELECT unique_values FROM counter_fields WHERE field='cs-username'),0),COALESCE((SELECT unique_values FROM counter_fields WHERE field='c-ip'),0),COALESCE((SELECT unique_values FROM counter_fields WHERE field='cs-host'),0) FROM totals".into()
    } else {
        format!("SELECT COUNT(*),COALESCE(SUM(bytes),0),COALESCE(SUM(issue_count>0),0),COALESCE(SUM(denied),0),MIN(ts),MAX(ts),COUNT(DISTINCT NULLIF(user,{empty})),COUNT(DISTINCT NULLIF(client,{empty})),COUNT(DISTINCT NULLIF(host,{empty})) FROM records r WHERE {predicate}", empty=if v3 {"0"}else{"''"})
    };
    let mut summary = if let Some(scope) = &scope {
        scope.summary.clone()
    } else {
        tx.query_row(&summary_sql, params_from_iter(args.iter()), |r| {
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
        .map_err(|e| e.to_string())?
    };
    if profile {
        eprintln!(
            "traffic_profile summary_ms={}",
            summary_started.elapsed().as_millis()
        );
    }
    let ranking_started = std::time::Instant::now();
    let duration = match (summary.first, summary.last) {
        (Some(first), Some(last)) => (query
            .end
            .unwrap_or(last)
            .saturating_sub(query.start.unwrap_or(first))
            as f64
            / 1000.)
            .max(1.),
        _ => 1.,
    };
    summary.requests_per_second = summary.requests as f64 / duration;
    summary.bytes_per_second = summary.bytes as f64 / duration;
    let mut rankings: HashMap<String, Vec<Ranking>> = HashMap::new();
    let mut ranking_counts: HashMap<String, usize> = HashMap::new();
    let mut range_rankings: HashMap<String, Vec<(String, i64, i64)>> = HashMap::new();
    let top = query.limit.clamp(1, 50) as i64;
    if !global {
        let grouped = precounted;
        if let Some(grouped) = grouped {
            for (field, counts) in grouped.iter() {
                let mut rows = counts.iter().collect::<Vec<_>>();
                rows.sort_by(|a, b| {
                    let av = if query.metric == "bytes" && field != "x-issue" {
                        a.2
                    } else {
                        a.1
                    };
                    let bv = if query.metric == "bytes" && field != "x-issue" {
                        b.2
                    } else {
                        b.1
                    };
                    bv.cmp(&av).then_with(|| a.0.cmp(&b.0))
                });
                let page = query
                    .ranking_pages
                    .get(field)
                    .copied()
                    .unwrap_or(1)
                    .max(1)
                    .min(rows.len().div_ceil(top as usize).max(1));
                ranking_counts.insert(field.clone(), rows.len());
                range_rankings.insert(
                    field.clone(),
                    rows.into_iter()
                        .skip((page - 1) * top as usize)
                        .take(top as usize)
                        .cloned()
                        .collect(),
                );
            }
        } else {
            // Materialize the timestamp/filter selection once. The dimension primary
            // key starts with record_id, so every selected row joins its memberships.
            let order = if query.metric == "bytes" {
                "CASE WHEN field='x-issue' THEN requests ELSE bytes END"
            } else {
                "requests"
            };
            let legacy_sql = format!("WITH selected AS MATERIALIZED (SELECT r.id,r.bytes FROM records r WHERE {predicate}), counts AS (SELECT d.field,d.name,COUNT(*) AS requests,COALESCE(SUM(r.bytes),0) AS bytes FROM selected r JOIN dimensions d ON d.record_id=r.id GROUP BY d.field,d.name), ordered AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY field ORDER BY {order} DESC,name) AS position,COUNT(*) OVER (PARTITION BY field) AS total FROM counts), paged AS (SELECT ordered.*,MAX(1,MIN(COALESCE(p.value,1),(total+?-1)/?)) AS page FROM ordered LEFT JOIN json_each(?) p ON p.key=ordered.field) SELECT field,name,requests,bytes,total FROM paged WHERE position>(page-1)*? AND position<=page*? ORDER BY field,position");
            let sql = if v3 {
                format!("WITH counts AS ({}), ordered AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY field ORDER BY {order} DESC,name) AS position,COUNT(*) OVER (PARTITION BY field) AS total FROM counts), paged AS (SELECT ordered.*,MAX(1,MIN(COALESCE(p.value,1),(total+?-1)/?)) AS page FROM ordered LEFT JOIN json_each(?) p ON p.key=ordered.field) SELECT field,name,requests,bytes,total FROM paged WHERE position>(page-1)*? AND position<=page*? ORDER BY field,position",v3_counts_sql(&predicate))
            } else {
                legacy_sql
            };
            let mut parameters = args.clone();
            parameters.push(top.into());
            parameters.push(top.into());
            parameters.push(
                serde_json::to_string(&query.ranking_pages)
                    .map_err(|e| e.to_string())?
                    .into(),
            );
            parameters.push(top.into());
            parameters.push(top.into());
            let mut statement = tx.prepare(&sql).map_err(|e| e.to_string())?;
            for row in statement
                .query_map(params_from_iter(parameters.iter()), |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, i64>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (field, name, requests, bytes, total) = row.map_err(|e| e.to_string())?;
                let total = usize::try_from(total)
                    .map_err(|e| format!("Invalid ranking count for {field}: {total} ({e})"))?;
                ranking_counts.insert(field.clone(), total);
                range_rankings
                    .entry(field)
                    .or_default()
                    .push((name, requests, bytes));
            }
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
            let count: i64 = tx
                .query_row(
                    "SELECT COALESCE((SELECT unique_values FROM counter_fields WHERE field=?),0)",
                    [field],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            let count = usize::try_from(count)
                .map_err(|e| format!("Invalid ranking count for {field}: {count} ({e})"))?;
            ranking_counts.insert(field.to_owned(), count);
            let page = query
                .ranking_pages
                .get(field)
                .copied()
                .unwrap_or(1)
                .max(1)
                .min(count.div_ceil(top as usize).max(1));
            let offset = (page - 1) * top as usize;
            let sql=format!("SELECT name,requests,bytes FROM counters WHERE field=? ORDER BY {metric} DESC,name LIMIT ? OFFSET ?");
            let mut statement = tx.prepare(&sql).map_err(|e| e.to_string())?;
            let result = statement
                .query_map(params![field, top, offset as i64], |r| {
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
    if profile {
        eprintln!(
            "traffic_profile rankings_ms={}",
            ranking_started.elapsed().as_millis()
        );
    }
    let tail_started = std::time::Instant::now();
    let options = filter_options(&tx)?;
    let sql = if global {
        "SELECT epoch,requests,bytes FROM timeline ORDER BY epoch".into()
    } else {
        {
            let bucket = if v3 {
                "((ts/60000)-(ts<0 AND ts%60000<>0))*60000"
            } else {
                "(ts/60000)*60000"
            };
            format!("SELECT {bucket},COUNT(*),COALESCE(SUM(bytes),0) FROM records r WHERE {predicate} AND ts IS NOT NULL GROUP BY {bucket} ORDER BY 1")
        }
    };
    let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
    let timeline = if let Some(scope) = &scope {
        scope.timeline.clone()
    } else {
        stmt.query_map(params_from_iter(args.iter()), |r| {
            Ok(TrafficBucket {
                epoch: r.get(0)?,
                requests: r.get::<_, i64>(1)? as usize,
                bytes: r.get::<_, i64>(2)? as u64,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };
    if !global && scope.is_none() {
        cache_scope(&range_key, summary.clone(), timeline.clone())?;
    }
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
    let (network_rankings, network_members, network_member_count, network_count) =
        network_rankings(&tx, &query, &predicate, &args, &summary)?;
    let result = TrafficQueryResult {
        network_rankings,
        network_members,
        network_member_count,
        network_count,
        summary,
        rankings,
        ranking_counts,
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
    if profile {
        eprintln!(
            "traffic_profile tail_ms={} total_ms={}",
            tail_started.elapsed().as_millis(),
            started.elapsed().as_millis()
        );
    }
    page_result(&tx, &query, &predicate, &args, result)
}
struct QueryRun {
    cancelled: AtomicBool,
    interrupt: Mutex<Option<rusqlite::InterruptHandle>>,
}
static QUERY_RUNS: OnceLock<Mutex<HashMap<String, Arc<QueryRun>>>> = OnceLock::new();
static CANCELLED_QUERIES: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
struct QueryGuard {
    id: String,
    run: Arc<QueryRun>,
}
impl Drop for QueryGuard {
    fn drop(&mut self) {
        if let Ok(mut runs) = QUERY_RUNS.get_or_init(|| Mutex::new(HashMap::new())).lock() {
            if runs
                .get(&self.id)
                .is_some_and(|run| Arc::ptr_eq(run, &self.run))
            {
                runs.remove(&self.id);
            }
        }
    }
}
#[tauri::command]
pub fn cancel_traffic_query(request_id: String) -> Result<(), String> {
    let mut cancelled = CANCELLED_QUERIES
        .get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .map_err(|e| e.to_string())?;
    cancelled.push_back(request_id.clone());
    while cancelled.len() > 128 {
        cancelled.pop_front();
    }
    if let Some(run) = QUERY_RUNS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|e| e.to_string())?
        .get(&request_id)
    {
        run.cancelled.store(true, Ordering::Relaxed);
        if let Some(handle) = run.interrupt.lock().map_err(|e| e.to_string())?.as_ref() {
            handle.interrupt();
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn query_traffic_capture(
    app: AppHandle,
    capture_id: String,
    query: TrafficQuery,
    request_id: Option<String>,
) -> Result<TrafficQueryResult, String> {
    let guard = if let Some(id) = request_id {
        let cancelled = CANCELLED_QUERIES
            .get_or_init(|| Mutex::new(VecDeque::new()))
            .lock()
            .map_err(|e| e.to_string())?;
        if cancelled.contains(&id) {
            return Err("Traffic query cancelled".into());
        }
        let run = Arc::new(QueryRun {
            cancelled: AtomicBool::new(false),
            interrupt: Mutex::new(None),
        });
        QUERY_RUNS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), Arc::clone(&run));
        Some(QueryGuard { id, run })
    } else {
        None
    };
    tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let conn = open(&app, &capture_id)?;
        if let Some(guard) = &_guard {
            *guard.run.interrupt.lock().map_err(|e| e.to_string())? =
                Some(conn.get_interrupt_handle());
            if guard.run.cancelled.load(Ordering::Relaxed) {
                return Err("Traffic query cancelled".into());
            }
        }
        query_connection(
            &conn,
            &path(&app, &capture_id)?.display().to_string(),
            query,
        )
    })
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
        "SELECT id FROM records r WHERE {predicate} {} ORDER BY r.ts,r.id LIMIT ? OFFSET ?",
        if query.errors_only {
            "AND issue_count>0"
        } else {
            ""
        }
    );
    let mut records = Vec::new();
    if !query.omit_records {
        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let ids = stmt
            .query_map(params_from_iter(record_args.iter()), |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if query.compact_records && is_v3(tx) {
            records = compact_records(tx, &ids)?;
        } else {
            for id in ids {
                records.push(if query.compact_records {
                    compact_record(tx, id)?
                } else {
                    read_record(tx, id)?
                });
            }
        }
    }

    result.records = records;
    result.page = page;
    result.page_size = size;
    result.total_records = total_records;
    result.total_pages = total_pages;
    Ok(result)
}

fn read_record(conn: &Connection, id: i64) -> Result<AccessLogRecord, String> {
    if is_v3(conn) {
        return crate::traffic_store_v3::record(conn, id);
    }
    let json: String = conn
        .query_row("SELECT record FROM records WHERE id=?", [id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut record: AccessLogRecord = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    record.store_id = Some(id);
    Ok(record)
}
fn compact_record(conn: &Connection, id: i64) -> Result<AccessLogRecord, String> {
    if !is_v3(conn) {
        let mut r = read_record(conn, id)?;
        r.raw_fields.retain(|name, _| {
            [
                "c-ip",
                "cs-username",
                "cs-host",
                "s-action",
                "sc-filter-result",
                "sc-status",
                "cs-bytes",
                "sc-bytes",
            ]
            .contains(&name.as_str())
        });
        r.raw_line.clear();
        r.schema.clear();
        r.normalized.clear();
        return Ok(r);
    }
    compact_records(conn, &[id])?
        .pop()
        .ok_or_else(|| "Traffic record not found".into())
}
fn compact_records(conn: &Connection, ids: &[i64]) -> Result<Vec<AccessLogRecord>, String> {
    let selection = serde_json::to_string(ids).map_err(|e| e.to_string())?;
    let mut issue_map: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt=conn.prepare("SELECT m.record_id,v.name FROM memberships m JOIN vals v ON v.id=m.value_id WHERE m.field=1 AND m.record_id IN (SELECT value FROM json_each(?)) ORDER BY v.name").map_err(|e|e.to_string())?;
    for row in stmt
        .query_map([&selection], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
    {
        let (id, name) = row.map_err(|e| e.to_string())?;
        issue_map.entry(id).or_default().push(name);
    }
    let mut stmt=conn.prepare("SELECT r.id,r.ts,r.bytes,c.name,u.name,h.name,a.name,f.name,s.name,o.name,k.sequence,k.original_id,r.display_ts FROM records r JOIN canonical k ON k.id=r.id JOIN sources o ON o.id=k.source_id JOIN vals c ON c.id=r.client JOIN vals u ON u.id=r.user JOIN vals h ON h.id=r.host JOIN vals a ON a.id=r.action JOIN vals f ON f.id=r.filter_result JOIN vals s ON s.id=r.status WHERE r.id IN (SELECT value FROM json_each(?)) ORDER BY r.ts,r.id").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([selection], |r| {
            let id: i64 = r.get(0)?;
            let mut fields = BTreeMap::new();
            for (i, name) in [
                "c-ip",
                "cs-username",
                "cs-host",
                "s-action",
                "sc-filter-result",
                "sc-status",
            ]
            .iter()
            .enumerate()
            {
                fields.insert((*name).into(), {
                    let value: String = r.get(i + 3)?;
                    crate::traffic_analysis::AccessLogValue {
                        raw: value.clone(),
                        availability: if value.is_empty() { "missing" } else { "value" }.into(),
                        value: if value.is_empty() { None } else { Some(value) },
                    }
                });
            }
            fields.insert(
                "cs-bytes".into(),
                crate::traffic_analysis::semantic_value(r.get::<_, i64>(2)?.to_string()),
            );
            let source: String = r.get(9)?;
            let sequence: i64 = r.get(10)?;
            let original: Option<String> = r.get(11)?;
            let issues = issue_map.remove(&id).unwrap_or_default();
            Ok(AccessLogRecord {
                store_id: Some(id),
                raw_line_reconstructed: true,
                id: original.unwrap_or_else(|| format!("{source}:{sequence}")),
                source,
                schema: Vec::new(),
                raw_line: String::new(),
                raw_fields: fields,
                normalized: BTreeMap::new(),
                timestamp: r
                    .get::<_, Option<i64>>(1)?
                    .and_then(chrono::DateTime::from_timestamp_millis)
                    .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
                    .or(r.get::<_, Option<String>>(12)?),
                malformed: issues.iter().any(|s| s == "Malformed record"),
                issues,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_traffic_record(
    app: AppHandle,
    capture_id: String,
    record_id: i64,
) -> Result<AccessLogRecord, String> {
    tokio::task::spawn_blocking(move || read_record(&open(&app, &capture_id)?, record_id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod store_tests {
    use super::*;
    use crate::traffic_store_v3::{
        self as v3,
        tests::{database, sample},
    };
    fn query(c: &Connection, mut q: TrafficQuery) -> TrafficQueryResult {
        if q.limit == 0 {
            q.limit = 1;
        }
        if q.page_size == 0 {
            q.page_size = 2;
        }
        // Unique cache identity for each in-memory DB, cache remains scoped across pagination tests.
        query_connection(c, &format!("test-{:p}", c), q).unwrap()
    }
    #[test]
    fn range_rankings_summary_pagination_networks_and_filters() {
        let mut c = database();
        v3::ingest(&mut c, &sample(), &[]).unwrap();
        let start = epoch(&sample()[0]).unwrap();
        let base = query(
            &c,
            TrafficQuery {
                start: Some(start),
                end: Some(start + 60000),
                compact_records: true,
                ..Default::default()
            },
        );
        assert_eq!(base.summary.requests, 3);
        assert_eq!(base.summary.bytes, 210);
        assert_eq!(base.summary.unique_clients, 2);
        assert_eq!(base.summary.unique_users, 2);
        assert_eq!(base.rankings["cs-host"][0].name, "a.example");
        assert_eq!(base.rankings["cs-host"][0].requests, 2);
        assert_eq!(base.total_pages, 2);
        assert_eq!(base.records.len(), 2);
        assert!(base
            .records
            .iter()
            .all(|r| r.raw_line.is_empty() && r.normalized.is_empty()));
        let next = query(
            &c,
            TrafficQuery {
                start: Some(start),
                end: Some(start + 60000),
                page: 2,
                ..Default::default()
            },
        );
        assert_eq!(next.records[0].id, "fixture:3");
        assert!(!next.records[0].raw_line.is_empty());
        let exact = query(
            &c,
            TrafficQuery {
                method: "GET".into(),
                status: "500".into(),
                ..Default::default()
            },
        );
        assert_eq!(exact.summary.requests, 1);
        let substring = query(
            &c,
            TrafficQuery {
                host: ".example".into(),
                ..Default::default()
            },
        );
        assert_eq!(substring.summary.requests, 3);
        let errors = query(
            &c,
            TrafficQuery {
                errors_only: true,
                ..Default::default()
            },
        );
        assert_eq!(errors.summary.requests, 3);
        assert_eq!(errors.total_records, 2);
        let network = query(
            &c,
            TrafficQuery {
                start: Some(start),
                network_prefix: Some(24),
                ..Default::default()
            },
        );
        assert_eq!(network.network_rankings[0].requests, 3);
        let page = query(
            &c,
            TrafficQuery {
                start: Some(start),
                ranking_pages: HashMap::from([("cs-host".into(), 2)]),
                ..Default::default()
            },
        );
        assert_eq!(page.rankings["cs-host"][0].name, "b.example");
        let report = query(
            &c,
            TrafficQuery {
                omit_records: true,
                metric: "bytes".into(),
                start: Some(start),
                ..Default::default()
            },
        );
        assert!(report.records.is_empty());
        assert_eq!(report.rankings["cs-host"][0].bytes, 140);
        let found = query(
            &c,
            TrafficQuery {
                search: "/two".into(),
                ..Default::default()
            },
        );
        assert_eq!(found.summary.requests, 1);
        let escaped = query(
            &c,
            TrafficQuery {
                search: "%".into(),
                ..Default::default()
            },
        );
        assert_eq!(escaped.summary.requests, 0);
        assert!(query_connection(
            &c,
            "invalid",
            TrafficQuery {
                start: Some(1),
                end: Some(0),
                ..Default::default()
            }
        )
        .is_err());
    }
    #[test]
    fn v2_reader_and_detail_remain_compatible_without_migration() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('version','2');CREATE TABLE records(id INTEGER PRIMARY KEY,ts INTEGER,bytes INTEGER,client TEXT,user TEXT,host TEXT,category TEXT,application TEXT,action TEXT,status TEXT,method TEXT,threat TEXT,search TEXT,issue_count INTEGER,denied INTEGER,record TEXT);").unwrap();
        let mut r = sample().remove(0);
        r.issues = issues(&r);
        c.execute("INSERT INTO records VALUES(1,0,30,'192.0.2.1','alice','a.example','News;Tech;News','','TCP_HIT','200','GET','','fixture',0,0,?)",[serde_json::to_string(&r).unwrap()]).unwrap();
        let actual = read_record(&c, 1).unwrap();
        assert_eq!(actual.id, r.id);
        assert_eq!(actual.raw_line, r.raw_line);
        assert!(!actual.raw_line_reconstructed);
        let lean = compact_record(&c, 1).unwrap();
        assert_eq!(lean.store_id, Some(1));
        assert!(lean.raw_line.is_empty());
        let (predicate, args) = conditions(
            &TrafficQuery {
                method: "GET".into(),
                host: "a.example".into(),
                ..Default::default()
            },
            false,
        );
        let count: i64 = c
            .query_row(
                &format!("SELECT COUNT(*) FROM records r WHERE {predicate}"),
                params_from_iter(args.iter()),
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert!(c.prepare("SELECT * FROM canonical").is_err());
    }
    #[test]
    fn range_cache_invalidates_for_late_rows_but_not_unrelated_minutes() {
        let mut c = database();
        let rows = sample();
        let start = epoch(&rows[0]).unwrap();
        v3::ingest(&mut c, &rows[..1], &[]).unwrap();
        let select = || TrafficQuery {
            start: Some(start),
            end: Some(start + 999),
            ..Default::default()
        };
        assert_eq!(query(&c, select()).summary.requests, 1);
        v3::ingest(&mut c, &rows[2..], &[]).unwrap();
        assert_eq!(query(&c, select()).summary.requests, 1);
        v3::ingest(&mut c, &rows[..1], &[]).unwrap();
        assert_eq!(query(&c, select()).summary.requests, 2);
    }
    fn legacy_fixture(rows: &[AccessLogRecord]) -> Connection {
        let mut c = database();
        v3::ingest(&mut c, rows, &[]).unwrap();
        c.execute_batch("UPDATE meta SET value='2' WHERE key='version';ALTER TABLE records RENAME TO facts_fixture;
          CREATE TABLE records(id INTEGER PRIMARY KEY,ts INTEGER,bytes INTEGER,client TEXT,user TEXT,host TEXT,category TEXT,application TEXT,action TEXT,status TEXT,method TEXT,threat TEXT,search TEXT,issue_count INTEGER,denied INTEGER,record TEXT);
          CREATE TABLE dimensions(record_id INTEGER,field TEXT,name TEXT,PRIMARY KEY(record_id,field,name));
          CREATE INDEX records_legacy_time ON records(ts,id);").unwrap();
        for (i, row) in rows.iter().enumerate() {
            let mut r = row.clone();
            r.issues = issues(row);
            let id = (i + 1) as i64;
            let traffic = ["cs-bytes", "sc-bytes"]
                .iter()
                .filter_map(|f| value(row, f).parse::<i64>().ok())
                .sum::<i64>();
            let search = row
                .raw_fields
                .values()
                .filter_map(|v| v.value.as_deref())
                .collect::<Vec<_>>()
                .join(" ");
            let threat = [
                "cs-threat-risk",
                "cs-threat-id",
                "rs-threat-id",
                "x-virus-id",
            ]
            .map(|f| value(row, f))
            .join(" ");
            c.execute(
                "INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                params![
                    id,
                    epoch(row),
                    traffic,
                    value(row, "c-ip"),
                    value(row, "cs-username"),
                    value(row, "cs-host"),
                    value(row, "cs-categories"),
                    value(row, "x-bluecoat-application-name"),
                    value(row, "s-action"),
                    value(row, "sc-status"),
                    value(row, "cs-method"),
                    threat,
                    search,
                    r.issues.len() as i64,
                    i64::from(
                        r.issues
                            .iter()
                            .any(|s| s == "Denied transaction" || s == "Policy denial")
                    ),
                    serde_json::to_string(&r).unwrap()
                ],
            )
            .unwrap();
            for (field, _) in v3::FIELDS {
                let name = value(row, field);
                if !name.is_empty() {
                    c.execute(
                        "INSERT OR IGNORE INTO dimensions VALUES(?,?,?)",
                        params![id, field, name],
                    )
                    .unwrap();
                }
            }
            for name in value(row, "cs-categories")
                .split(';')
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                c.execute(
                    "INSERT OR IGNORE INTO dimensions VALUES(?,'cs-categories',?)",
                    params![id, name],
                )
                .unwrap();
            }
            for name in r.issues {
                c.execute(
                    "INSERT OR IGNORE INTO dimensions VALUES(?,'x-issue',?)",
                    params![id, name],
                )
                .unwrap();
            }
        }
        c
    }
    #[test]
    fn v2_v3_analytics_and_report_queries_are_equivalent() {
        let rows = sample();
        let legacy = legacy_fixture(&rows);
        let mut compact = database();
        v3::ingest(&mut compact, &rows, &[]).unwrap();
        let start = epoch(&rows[0]).unwrap();
        for filters in [
            TrafficQuery::default(),
            TrafficQuery {
                start: Some(start),
                end: Some(start + 1000),
                ..Default::default()
            },
            TrafficQuery {
                search: "example".into(),
                ..Default::default()
            },
            TrafficQuery {
                category: "Tech".into(),
                ..Default::default()
            },
            TrafficQuery {
                threat: " ".into(),
                ..Default::default()
            },
            TrafficQuery {
                method: "GET".into(),
                ..Default::default()
            },
        ] {
            for metric in ["requests", "bytes"] {
                let mut q: TrafficQuery =
                    serde_json::from_value(serde_json::to_value(&filters).unwrap()).unwrap();
                q.metric = metric.into();
                q.omit_records = true;
                q.limit = 50;
                q.network_prefix = Some(24);
                let q2 = serde_json::from_value(serde_json::to_value(&q).unwrap()).unwrap();
                let left =
                    query_connection(&legacy, &format!("legacy-{start}-{metric}"), q).unwrap();
                let right =
                    query_connection(&compact, &format!("compact-{start}-{metric}"), q2).unwrap();
                assert_eq!(
                    serde_json::to_value(left).unwrap(),
                    serde_json::to_value(right).unwrap()
                );
            }
        }
    }
    #[test]
    fn streaming_dictionary_growth_is_read_in_one_snapshot() {
        let mut c = database();
        let rows = sample();
        v3::ingest(&mut c, &rows[..1], &[]).unwrap();
        assert_eq!(
            query(
                &c,
                TrafficQuery {
                    search: "bob".into(),
                    ..Default::default()
                }
            )
            .summary
            .requests,
            0
        );
        v3::ingest(&mut c, &rows[1..], &[]).unwrap();
        assert_eq!(
            query(
                &c,
                TrafficQuery {
                    search: "bob".into(),
                    ..Default::default()
                }
            )
            .summary
            .requests,
            1
        );
    }
    #[test]
    #[ignore = "Synthetic benchmark writes only a uniquely created temporary database; opt in explicitly"]
    fn benchmark_compact_store() {
        use crate::traffic_analysis::AccessLogParser;
        use std::time::Instant;
        let count = std::env::var("TRAFFIC_BENCH_ROWS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(100_000)
            .clamp(1000, 2_000_000);
        let file = std::env::temp_dir().join(format!(
            "proxytools-traffic-bench-{}-{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&file)
            .unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for suffix in ["", "-wal", "-shm"] {
                    let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
                }
            }
        }
        let _cleanup = Cleanup(file.clone());
        let mut c = Connection::open(&file).unwrap();
        c.execute_batch("PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('version','3');").unwrap();
        v3::create(&c).unwrap();
        let parser=AccessLogParser{fields:"date time c-ip cs-username cs-host cs-method sc-status s-action cs-categories cs-bytes sc-bytes cs-uri-path cs(User-Agent)".split_whitespace().map(str::to_owned).collect()};
        let begin = Instant::now();
        let mut raw = 0usize;
        let mut old_json = 0usize;
        for offset in (0..count).step_by(1000) {
            let mut batch = Vec::new();
            for i in offset..(offset + 1000).min(count) {
                let second = i % 86400;
                let line=format!("2026-01-01 {:02}:{:02}:{:02} 192.0.{}.{} user{} host{}.example {} {} {} \"News;Tech\" {} {} /unique/path/{i}?q={} \"Synthetic Browser 1.0\"",second/3600,(second/60)%60,second%60,(i/254)%254,i%254+1,i%2000,i%10000,if i%10==0{"POST"}else{"GET"},if i%20==0{403}else{200},if i%20==0{"DENIED"}else{"TCP_HIT"},i%1000,i%10000,i*17);
                raw += line.len();
                let r = parser.parse_line(&line, "synthetic.log", i + 1).unwrap().0;
                old_json += serde_json::to_vec(&r).unwrap().len();
                batch.push(r);
            }
            v3::ingest(&mut c, &batch, &[]).unwrap();
        }
        let ingest_ms = begin.elapsed().as_millis();
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        let payload: i64 = c
            .query_row(
                "SELECT SUM(length(tokens)+COALESCE(length(exception),0)) FROM canonical",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let bytes = std::fs::metadata(&file).unwrap().len();
        let start =
            chrono::NaiveDateTime::parse_from_str("2026-01-01 00:00:00", "%Y-%m-%d %H:%M:%S")
                .unwrap()
                .and_utc()
                .timestamp_millis();
        if std::env::var_os("TRAFFIC_QUERY_PROFILE").is_some() {
            for sql in ["SELECT r.bytes,r.client,r.user,r.host,r.application,r.action,r.status,r.method,r.filter_result,r.policy_action,r.risk,r.ts,r.issue_count,r.denied FROM records r WHERE r.ts>=? AND r.ts<=?", "SELECT m.field,m.value_id,r.bytes FROM records r CROSS JOIN memberships m ON m.record_id=r.id WHERE r.ts>=? AND r.ts<=?"] {
                let mut statement=c.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
                let plan=statement.query_map(params![start,start+86_400_000],|r|r.get::<_,String>(3)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();eprintln!("traffic_explain actual_scan {plan:?}");
            }
            for (label,sql) in [("fallback-rankings",v3_counts_sql("r.ts>=? AND r.ts<=?")),("summary","SELECT COUNT(*),SUM(bytes),COUNT(DISTINCT NULLIF(user,0)),COUNT(DISTINCT NULLIF(client,0)),COUNT(DISTINCT NULLIF(host,0)) FROM records r WHERE r.ts>=? AND r.ts<=?".into())] {
                let mut stmt=c.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
                let plans=stmt.query_map(params![start,start+86_400_000],|r|r.get::<_,String>(3)).unwrap().collect::<Result<Vec<_>,_>>().unwrap();
                eprintln!("traffic_explain {label} {plans:?}");
            }
        }
        drop(c);
        let c = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let mut timings = Vec::new();
        for (label, q) in [
            (
                "range-first-reader",
                TrafficQuery {
                    start: Some(start),
                    end: Some(start + 86_400_000),
                    omit_records: true,
                    limit: 10,
                    ..Default::default()
                },
            ),
            (
                "ranking-page-reuse",
                TrafficQuery {
                    start: Some(start),
                    end: Some(start + 86_400_000),
                    omit_records: true,
                    limit: 10,
                    ranking_pages: HashMap::from([("cs-host".into(), 5)]),
                    ..Default::default()
                },
            ),
            (
                "metric-reuse",
                TrafficQuery {
                    start: Some(start),
                    end: Some(start + 86_400_000),
                    omit_records: true,
                    limit: 10,
                    metric: "bytes".into(),
                    ..Default::default()
                },
            ),
            (
                "substring-search",
                TrafficQuery {
                    search: "/unique/path/987".into(),
                    omit_records: true,
                    limit: 10,
                    ..Default::default()
                },
            ),
            (
                "deep-page",
                TrafficQuery {
                    page: count / 100,
                    page_size: 100,
                    compact_records: true,
                    limit: 10,
                    ..Default::default()
                },
            ),
        ] {
            let t = Instant::now();
            let result = query_connection(&c, &file.display().to_string(), q).unwrap();
            timings.push((label, t.elapsed().as_millis(), result.summary.requests));
        }
        eprintln!("traffic_benchmark rows={count} raw_bytes={raw} legacy_json_payload_bytes={old_json} canonical_payload_bytes={payload} v3_database_bytes={bytes} debug_assertions={} ingest_ms={ingest_ms} query_ms={timings:?}", cfg!(debug_assertions));
        drop(c);
    }
    #[test]
    fn quoted_semantic_values_are_not_decoded_twice_in_compact_pages() {
        let parser = crate::traffic_analysis::AccessLogParser {
            fields: vec!["cs-username".into(), "cs-host".into()],
        };
        let row = parser
            .parse_line(r#""\"alice\"" "\"None\"""#, "quoted", 1)
            .unwrap()
            .0;
        let mut c = database();
        v3::ingest(&mut c, &[row.clone()], &[]).unwrap();
        let compact = compact_records(&c, &[1]).unwrap().remove(0);
        assert_eq!(
            compact.raw_fields["cs-username"].value,
            row.raw_fields["cs-username"].value
        );
        assert_eq!(
            compact.raw_fields["cs-host"].value,
            row.raw_fields["cs-host"].value
        );
    }
    #[test]
    fn v2_file_reader_is_read_only_and_does_not_change_file_bytes() {
        let file = std::env::temp_dir().join(format!(
            "proxytools-v2-readonly-{}-{}.sqlite",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&file)
            .unwrap();
        let c = Connection::open(&file).unwrap();
        c.execute_batch(
            "CREATE TABLE meta(key TEXT,value TEXT);INSERT INTO meta VALUES('version','2');",
        )
        .unwrap();
        drop(c);
        let before = std::fs::read(&file).unwrap();
        let c = open_file(&file).unwrap();
        assert!(!is_v3(&c));
        assert!(c
            .execute_batch("CREATE TABLE forbidden(id INTEGER)")
            .is_err());
        drop(c);
        assert_eq!(std::fs::read(&file).unwrap(), before);
        std::fs::remove_file(file).unwrap();
    }
    #[test]
    fn cancellation_marks_work_and_cleans_up_registry() {
        let c = Connection::open_in_memory().unwrap();
        let run = Arc::new(QueryRun {
            cancelled: AtomicBool::new(false),
            interrupt: Mutex::new(Some(c.get_interrupt_handle())),
        });
        let id = format!(
            "cancel-test-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        );
        QUERY_RUNS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap()
            .insert(id.clone(), Arc::clone(&run));
        cancel_traffic_query(id.clone()).unwrap();
        assert!(run.cancelled.load(Ordering::Relaxed));
        assert!(CANCELLED_QUERIES
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .contains(&id));
        drop(QueryGuard {
            id: id.clone(),
            run,
        });
        assert!(!QUERY_RUNS.get().unwrap().lock().unwrap().contains_key(&id));
    }
    #[test]
    fn obsolete_query_interrupts_an_active_sql_statement() {
        let c = Connection::open_in_memory().unwrap();
        let (sent, started) = std::sync::mpsc::channel();
        let sent = Mutex::new(Some(sent));
        c.create_scalar_function(
            "started",
            0,
            rusqlite::functions::FunctionFlags::default(),
            move |_| {
                if let Some(sent) = sent.lock().unwrap().take() {
                    sent.send(()).unwrap();
                }
                Ok(1i64)
            },
        )
        .unwrap();
        let run = Arc::new(QueryRun {
            cancelled: AtomicBool::new(false),
            interrupt: Mutex::new(Some(c.get_interrupt_handle())),
        });
        let id = format!(
            "active-cancel-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        );
        QUERY_RUNS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .unwrap()
            .insert(id.clone(), Arc::clone(&run));
        let thread = std::thread::spawn(move || {
            c.query_row("WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<10000000) SELECT SUM(started()) FROM n",[],|r|r.get::<_,i64>(0))
        });
        started.recv_timeout(Duration::from_secs(5)).unwrap();
        cancel_traffic_query(id.clone()).unwrap();
        assert!(thread.join().unwrap().is_err());
        drop(QueryGuard { id, run });
    }
    #[test]
    fn pre_epoch_minute_buckets_match_global_and_filtered_results() {
        let p = crate::traffic_analysis::AccessLogParser {
            fields: vec!["date".into(), "time".into()],
        };
        let row = p.parse_line("1969-12-31 23:59:59", "old", 1).unwrap().0;
        let mut c = database();
        v3::ingest(&mut c, &[row], &[]).unwrap();
        let all = query(&c, TrafficQuery::default());
        let filtered = query(
            &c,
            TrafficQuery {
                start: Some(-1000),
                ..Default::default()
            },
        );
        assert_eq!(all.timeline[0].epoch, -60000);
        assert_eq!(all.timeline[0].epoch, filtered.timeline[0].epoch);
    }
    #[test]
    fn range_cache_refreshes_global_filter_options_after_unrelated_ingest() {
        let mut c = database();
        let mut rows = sample();
        let start = epoch(&rows[0]).unwrap();
        v3::ingest(&mut c, &rows[..1], &[]).unwrap();
        let selection = || TrafficQuery {
            start: Some(start),
            end: Some(start + 999),
            ..Default::default()
        };
        assert!(!query(&c, selection()).options["cs-method"].contains(&"PATCH".into()));
        rows[2].raw_fields.insert(
            "cs-method".into(),
            crate::traffic_analysis::semantic_value("PATCH".into()),
        );
        rows[2].raw_line = rows[2].raw_line.replace("GET", "PATCH");
        v3::ingest(&mut c, &rows[2..], &[]).unwrap();
        let selected = query(&c, selection());
        assert_eq!(selected.summary.requests, 1);
        assert!(selected.options["cs-method"].contains(&"PATCH".into()));
    }
    #[test]
    fn compact_pages_preserve_unindexable_timestamp_text() {
        let p = crate::traffic_analysis::AccessLogParser {
            fields: vec!["date".into(), "time".into()],
        };
        let r = p
            .parse_line("2026-01-01 00:00:00.500", "fraction", 1)
            .unwrap()
            .0;
        assert!(epoch(&r).is_none());
        let mut c = database();
        v3::ingest(&mut c, &[r.clone()], &[]).unwrap();
        let summary = compact_records(&c, &[1]).unwrap();
        assert_eq!(summary[0].timestamp, r.timestamp);
    }
    #[test]
    fn high_cardinality_sql_fallback_matches_cached_integer_aggregation() {
        let mut c = database();
        let rows = sample();
        v3::ingest(&mut c, &rows, &[]).unwrap();
        let make = || TrafficQuery {
            start: epoch(&rows[0]),
            end: epoch(&rows[2]),
            metric: "bytes".into(),
            limit: 1,
            ranking_pages: HashMap::from([("cs-host".into(), 2)]),
            omit_records: true,
            ..Default::default()
        };
        let expected = query_connection(&c, "fallback-reference", make()).unwrap();
        let mut selection = serde_json::to_value(make()).unwrap();
        let object = selection.as_object_mut().unwrap();
        for key in [
            "page",
            "pageSize",
            "errorsOnly",
            "compactRecords",
            "omitRecords",
            "rankingPages",
            "metric",
            "limit",
            "networkPrefix",
            "network",
            "networkPage",
            "networkListPage",
        ] {
            object.remove(key);
        }
        let identity = format!(
            "forced-fallback-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        );
        let key = format!("{identity}:3:{selection}");
        LARGE_RANGES
            .get_or_init(|| Mutex::new(VecDeque::new()))
            .lock()
            .unwrap()
            .push_back(key);
        let actual = query_connection(&c, &identity, make()).unwrap();
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
}
