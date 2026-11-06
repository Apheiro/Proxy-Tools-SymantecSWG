use super::parser::{finite, hash, Parsed};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

type Result<T> = std::result::Result<T, String>;
fn db_error(_: rusqlite::Error) -> String {
    "Active Connections database operation failed".into()
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: i64,
    pub received_at: i64,
    pub device_time: Option<String>,
    pub endpoint: String,
    pub sessions: Option<i64>,
    pub connections: Option<i64>,
    pub parsed_sessions: Option<i64>,
    pub parsed_connections: Option<i64>,
    pub clients: Option<i64>,
    pub duration_ms: i64,
    pub response_bytes: i64,
    pub quality: String,
    pub warnings: Vec<String>,
    pub content_hash: Option<String>,
    pub clock_skew_ms: Option<i64>,
}
pub fn open(path: &Path, scope: &str, readonly: bool) -> Result<Connection> {
    let conn = if readonly {
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
    } else {
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
    }
    .map_err(db_error)?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(db_error)?;
    let saved_scope: String = conn
        .query_row("SELECT scope FROM captures WHERE id=1", [], |r| r.get(0))
        .map_err(db_error)?;
    if saved_scope != scope {
        return Err("Capture belongs to another proxy/profile".into());
    }
    Ok(conn)
}
pub fn create(path: &Path, scope: &str, interval: u64, now: i64) -> Result<()> {
    let conn = Connection::open(path).map_err(db_error)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
CREATE TABLE captures(id INTEGER PRIMARY KEY,version INTEGER NOT NULL,scope TEXT NOT NULL,started INTEGER,ended INTEGER,interval_seconds INTEGER,saved INTEGER NOT NULL DEFAULT 0,route TEXT);
CREATE TABLE metadata(id INTEGER PRIMARY KEY,hash TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
CREATE TABLE snapshots(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,payload TEXT NOT NULL,metadata_id INTEGER);
CREATE INDEX snapshots_time ON snapshots(ts,id);
CREATE TABLE sessions(id TEXT PRIMARY KEY,first_seen INTEGER,last_seen INTEGER,ambiguous INTEGER);
CREATE TABLE connections(id TEXT PRIMARY KEY,parent TEXT,first_seen INTEGER,last_seen INTEGER,ambiguous INTEGER);
CREATE INDEX connections_parent ON connections(parent);
CREATE TABLE states(id INTEGER PRIMARY KEY,hash TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,client TEXT,server TEXT,application TEXT,protocol TEXT,kind TEXT,client_active TEXT,server_active TEXT,duration REAL,error TEXT);
CREATE INDEX states_client ON states(client,id); CREATE INDEX states_server ON states(server,id);
CREATE TABLE observations(connection_id TEXT NOT NULL,state_id INTEGER NOT NULL,first_sample INTEGER NOT NULL,last_sample INTEGER NOT NULL,session_no INTEGER NOT NULL,ordinal INTEGER NOT NULL,PRIMARY KEY(connection_id,first_sample)) WITHOUT ROWID;
CREATE INDEX observations_range ON observations(first_sample,last_sample,state_id);
CREATE INDEX observations_last ON observations(last_sample,connection_id);
CREATE TABLE poll_errors(snapshot_id INTEGER PRIMARY KEY,quality TEXT NOT NULL,message TEXT NOT NULL);
PRAGMA user_version=1;").map_err(db_error)?;
    let interval = i64::try_from(interval)
        .map_err(|_| "Sampling interval exceeds SQLite integer range".to_string())?;
    conn.execute(
        "INSERT INTO captures(id,version,scope,started,interval_seconds) VALUES(1,1,?,?,?)",
        params![scope, now, interval],
    )
    .map_err(db_error)?;
    Ok(())
}
pub fn append(
    path: &Path,
    scope: &str,
    mut sample: Snapshot,
    parsed: Option<Parsed>,
) -> Result<Snapshot> {
    let mut conn = open(path, scope, false)?;
    let tx = conn.transaction().map_err(db_error)?;
    let previous: Option<i64> = tx
        .query_row("SELECT max(id) FROM snapshots", [], |r| r.get(0))
        .map_err(db_error)?;
    sample.id = previous.unwrap_or(0) + 1;
    let mut metadata_id = None;
    if let Some(p) = parsed {
        sample.sessions = Some(p.reported_sessions);
        sample.connections = Some(p.reported_connections);
        sample.parsed_sessions = Some(p.sessions as i64);
        sample.parsed_connections = Some(p.members.len() as i64);
        sample.clients = Some(p.clients as i64);
        sample.quality =
            if p.reported_sessions == 0 && p.reported_connections == 0 && p.members.is_empty() {
                "Empty"
            } else {
                "OK"
            }
            .into();
        sample.device_time = p.device_time;
        sample.clock_skew_ms = sample
            .device_time
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.timestamp_millis() - sample.received_at);
        sample.warnings.extend(p.warnings);
        let payload =
            serde_json::to_string(&p.metadata).map_err(|_| "Could not encode metadata")?;
        let digest = hash(&payload);
        tx.execute(
            "INSERT OR IGNORE INTO metadata(hash,payload) VALUES(?,?)",
            params![digest, payload],
        )
        .map_err(db_error)?;
        metadata_id = Some(
            tx.query_row("SELECT id FROM metadata WHERE hash=?", [digest], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(db_error)?,
        );
        for member in p.members {
            let raw = &member.raw;
            let parent = if member.parent_ambiguous {
                format!("{}:{}:{}", member.parent, sample.id, member.session)
            } else {
                member.parent.clone()
            };
            let key = if member.ambiguous {
                format!(
                    "{}:{}:{}:{}",
                    member.key, sample.id, member.session, member.ordinal
                )
            } else {
                member.key.clone()
            };
            tx.prepare_cached("INSERT INTO sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen").map_err(db_error)?.execute(params![parent,sample.id,sample.id,member.parent_ambiguous]).map_err(db_error)?;
            tx.prepare_cached("INSERT INTO connections VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen").map_err(db_error)?.execute(params![key,parent,sample.id,sample.id,member.ambiguous]).map_err(db_error)?;
            let payload =
                serde_json::to_string(raw).map_err(|_| "Could not encode connection state")?;
            let digest = hash(&payload);
            tx.prepare_cached("INSERT OR IGNORE INTO states(hash,payload,client,server,application,protocol,kind,client_active,server_active,duration,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)").map_err(db_error)?.execute(params![digest,payload,raw.field("Client","Address"),raw.field("Server","Address"),raw.field("Service","Application"),raw.field("Service","Protocol"),raw.value("Type"),raw.field("Client","Active"),raw.field("Server","Active"),finite(raw.field("Duration","Seconds")),raw.value("Error")]).map_err(db_error)?;
            let state_id: i64 = tx
                .prepare_cached("SELECT id FROM states WHERE hash=?")
                .map_err(db_error)?
                .query_row([digest], |r| r.get(0))
                .map_err(db_error)?;
            let changed = if let Some(prev) = previous {
                tx.prepare_cached("UPDATE observations SET last_sample=? WHERE connection_id=? AND last_sample=? AND state_id=? AND session_no=? AND ordinal=?").map_err(db_error)?.execute(params![sample.id,key,prev,state_id,member.session as i64,member.ordinal as i64]).map_err(db_error)?
            } else {
                0
            };
            if changed == 0 {
                tx.prepare_cached("INSERT INTO observations VALUES(?,?,?,?,?,?)")
                    .map_err(db_error)?
                    .execute(params![
                        key,
                        state_id,
                        sample.id,
                        sample.id,
                        member.session as i64,
                        member.ordinal as i64
                    ])
                    .map_err(db_error)?;
            }
        }
        tx.execute("UPDATE captures SET route=? WHERE id=1", [&sample.endpoint])
            .map_err(db_error)?;
    } else {
        tx.execute(
            "INSERT INTO poll_errors VALUES(?,?,?)",
            params![sample.id, sample.quality, sample.warnings.join("; ")],
        )
        .map_err(db_error)?;
    }
    tx.execute(
        "INSERT INTO snapshots VALUES(?,?,?,?)",
        params![
            sample.id,
            sample.received_at,
            serde_json::to_string(&sample).map_err(|_| "Could not encode snapshot")?,
            metadata_id
        ],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(sample)
}
pub fn finish(path: &Path, scope: &str) -> Result<()> {
    let conn = open(path, scope, false)?;
    conn.execute(
        "UPDATE captures SET ended=? WHERE id=1",
        [chrono::Utc::now().timestamp_millis()],
    )
    .map_err(db_error)?;
    Ok(())
}
pub fn save(path: &Path, scope: &str) -> Result<()> {
    let conn = open(path, scope, false)?;
    conn.execute("UPDATE captures SET saved=1 WHERE id=1", [])
        .map_err(db_error)?;
    Ok(())
}
pub fn archive(path: &Path, scope: &str, id: &str) -> Result<Option<Value>> {
    let conn = open(path, scope, true)?;
    conn.query_row("SELECT started,ended,interval_seconds,route FROM captures WHERE saved=1", [], |r| Ok(json!({"id":id,"started":r.get::<_,i64>(0)?,"ended":r.get::<_,Option<i64>>(1)?,"interval":r.get::<_,i64>(2)?,"route":r.get::<_,Option<String>>(3)?}))).optional().map_err(db_error)
}
#[derive(Deserialize)]
pub struct Query {
    pub kind: String,
    pub snapshot: Option<i64>,
    pub offset: Option<i64>,
    pub limit: Option<i64>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub after: Option<i64>,
    pub before: Option<i64>,
    pub connection: Option<String>,
    pub filter: Option<String>,
}
pub fn query(conn: &Connection, q: Query) -> Result<Value> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    if q.kind == "timeline" {
        let mut stmt = conn.prepare("SELECT payload FROM snapshots WHERE ts>=? AND ts<=? ORDER BY id DESC LIMIT ? OFFSET ?").map_err(db_error)?;
        let rows = stmt
            .query_map(
                params![
                    q.after.unwrap_or(i64::MIN),
                    q.before.unwrap_or(i64::MAX),
                    limit,
                    offset
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(db_error)?;
        let mut items: Vec<Value> = Vec::new();
        for row in rows {
            items.push(
                serde_json::from_str(&row.map_err(db_error)?)
                    .map_err(|_| "Invalid stored sample")?,
            );
        }
        items.reverse();
        let total: i64 = conn
            .query_row(
                "SELECT count(*) FROM snapshots WHERE ts>=? AND ts<=?",
                params![q.after.unwrap_or(i64::MIN), q.before.unwrap_or(i64::MAX)],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        return Ok(json!({"items":items,"total":total}));
    }
    let sample = match q.snapshot {
        Some(id) => id,
        None => conn
            .query_row("SELECT max(id) FROM snapshots", [], |r| {
                r.get::<_, Option<i64>>(0)
            })
            .map_err(db_error)?
            .unwrap_or(0),
    };
    if q.kind == "metadata" {
        let raw: Option<String> = conn.query_row("SELECT m.payload FROM snapshots s JOIN metadata m ON m.id=s.metadata_id WHERE s.id=?",[sample],|r|r.get(0)).optional().map_err(db_error)?;
        return Ok(json!({"raw":raw.and_then(|s| serde_json::from_str::<Value>(&s).ok())}));
    }
    if q.kind == "detail" {
        let raw: Option<(String,String,i64,i64,bool,i64,i64)> = conn.query_row("SELECT s.payload,c.parent,c.first_seen,c.last_seen,c.ambiguous,(SELECT ts FROM snapshots WHERE id=c.first_seen),(SELECT ts FROM snapshots WHERE id=c.last_seen) FROM observations o JOIN states s ON s.id=o.state_id JOIN connections c ON c.id=o.connection_id WHERE o.first_sample<=? AND o.last_sample>=? AND c.id=?",params![sample,sample,q.connection.unwrap_or_default()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(db_error)?;
        return Ok(raw.map(|(r,parent,first,last,ambiguous,first_at,last_at)|json!({"raw":serde_json::from_str::<Value>(&r).ok(),"parent":parent,"first_observed_sample":first,"last_observed_sample":last,"first_observed_at":first_at,"last_observed_at":last_at,"ambiguous":ambiguous})).unwrap_or(Value::Null));
    }
    let search = format!(
        "%{}%",
        q.search
            .unwrap_or_default()
            .chars()
            .take(256)
            .collect::<String>()
    );
    let filter = match q.filter.as_deref() {
        Some("long") => " AND s.duration>3600",
        Some("legs") => " AND s.client_active='1' AND s.server_active='0'",
        Some("errors") => " AND ((s.error IS NOT NULL AND s.error NOT IN ('0','false','')))",
        _ => "",
    };
    let base = format!("FROM observations o JOIN states s ON s.id=o.state_id JOIN connections c ON c.id=o.connection_id WHERE o.first_sample<=?1 AND o.last_sample>=?1 AND (coalesce(s.client,'') LIKE ?2 OR coalesce(s.server,'') LIKE ?2 OR coalesce(s.application,'') LIKE ?2 OR coalesce(s.protocol,'') LIKE ?2){filter}");
    if matches!(q.kind.as_str(), "clients" | "destinations") {
        let field = if q.kind == "clients" {
            "client"
        } else {
            "server"
        };
        let sql = format!("SELECT s.{field},count(*),sum(CASE WHEN s.client_active='1' THEN 1 ELSE 0 END),sum(CASE WHEN s.kind='Primary' THEN 1 ELSE 0 END) {base} GROUP BY s.{field} ORDER BY count(*) DESC,s.{field} LIMIT ?3 OFFSET ?4");
        let mut stmt = conn.prepare(&sql).map_err(db_error)?;
        let rows = stmt.query_map(params![sample,search,limit,offset],|r|Ok(json!({"name":r.get::<_,Option<String>>(0)?,"observed_members":r.get::<_,i64>(1)?,"active_client_legs":r.get::<_,i64>(2)?,"primary_members":r.get::<_,i64>(3)?}))).map_err(db_error)?;
        let items = rows
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(db_error)?;
        let total: i64 = conn
            .query_row(
                &format!("SELECT count(*) FROM (SELECT s.{field} {base} GROUP BY s.{field})"),
                params![sample, search],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        return Ok(json!({"items":items,"total":total,"snapshot":sample}));
    }
    let order = match q.sort.as_deref() {
        Some("client") => "s.client,o.session_no,o.ordinal",
        Some("server") => "s.server,o.session_no,o.ordinal",
        Some("duration") => "s.duration DESC,o.session_no,o.ordinal",
        _ => "o.session_no,o.ordinal",
    };
    let mut stmt = conn.prepare(&format!("SELECT c.id,c.parent,c.ambiguous,o.session_no,o.ordinal,s.client,s.server,s.application,s.protocol,s.kind,s.client_active,s.server_active,s.duration,s.error {base} ORDER BY {order} LIMIT ?3 OFFSET ?4")).map_err(db_error)?;
    let rows = stmt.query_map(params![sample,search,limit.min(100),offset], |r|Ok(json!({"id":r.get::<_,String>(0)?,"parent":r.get::<_,String>(1)?,"ambiguous":r.get::<_,bool>(2)?,"session":r.get::<_,i64>(3)?,"ordinal":r.get::<_,i64>(4)?,"client":r.get::<_,Option<String>>(5)?,"server":r.get::<_,Option<String>>(6)?,"application":r.get::<_,Option<String>>(7)?,"protocol":r.get::<_,Option<String>>(8)?,"kind":r.get::<_,Option<String>>(9)?,"client_active":r.get::<_,Option<String>>(10)?,"server_active":r.get::<_,Option<String>>(11)?,"duration":r.get::<_,Option<f64>>(12)?,"error":r.get::<_,Option<String>>(13)?}))).map_err(db_error)?;
    let items = rows
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    let total: i64 = conn
        .query_row(
            &format!("SELECT count(*) {base}"),
            params![sample, search],
            |r| r.get(0),
        )
        .map_err(db_error)?;
    Ok(json!({"items":items,"total":total,"snapshot":sample}))
}
