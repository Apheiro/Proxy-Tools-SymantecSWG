//! Canonical token format 1 / projection 1. No per-request JSON or search copy.
//! Only this module interprets the codec; SQL sees small, disposable facts.
use crate::traffic_analysis::{
    tokenize_elff, AccessLogDiagnostic, AccessLogParser, AccessLogRecord,
};
use crate::traffic_store::{epoch, issues};
use rusqlite::{params, Connection, Transaction};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

type Result<T> = std::result::Result<T, String>;
pub(crate) const FIELDS: [(&str, &str); 10] = [
    ("c-ip", "client"),
    ("cs-username", "user"),
    ("cs-host", "host"),
    ("x-bluecoat-application-name", "application"),
    ("s-action", "action"),
    ("sc-status", "status"),
    ("cs-method", "method"),
    ("sc-filter-result", "filter_result"),
    ("x-bluecoat-access-security-policy-action", "policy_action"),
    ("cs-threat-risk", "risk"),
];
const TOKEN_DICTIONARY_LIMIT: i64 = 4096;

pub(crate) fn create(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE vals(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,lexical INTEGER NOT NULL DEFAULT 0);
      INSERT INTO vals VALUES(0,'',0);
      CREATE TABLE schemas(id INTEGER PRIMARY KEY,fields TEXT NOT NULL UNIQUE);
      CREATE TABLE sources(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
      CREATE TABLE canonical(id INTEGER PRIMARY KEY,schema_id INTEGER NOT NULL,source_id INTEGER NOT NULL,sequence INTEGER NOT NULL,original_id TEXT,tokens BLOB NOT NULL,exception TEXT);
      CREATE TABLE records(id INTEGER PRIMARY KEY,ts INTEGER,bytes INTEGER NOT NULL,client INTEGER,user INTEGER,host INTEGER,category INTEGER,application INTEGER,action INTEGER,status INTEGER,method INTEGER,filter_result INTEGER,policy_action INTEGER,risk INTEGER,issue_count INTEGER,denied INTEGER,display_ts TEXT);
      CREATE INDEX records_time ON records(ts,id);
      CREATE INDEX records_issues_time ON records(ts,id) WHERE issue_count>0;
      CREATE INDEX records_client_time ON records(client,ts);
      CREATE INDEX records_host_time ON records(host,ts);
      CREATE TABLE memberships(record_id INTEGER,field INTEGER,value_id INTEGER,PRIMARY KEY(record_id,field,value_id)) WITHOUT ROWID;
      CREATE INDEX memberships_value ON memberships(field,value_id,record_id);
      CREATE TABLE counters(field TEXT,name TEXT,requests INTEGER,bytes INTEGER,PRIMARY KEY(field,name));
      CREATE TABLE counter_fields(field TEXT PRIMARY KEY,unique_values INTEGER NOT NULL);
      CREATE INDEX counters_requests ON counters(field,requests DESC,name);
      CREATE INDEX counters_bytes ON counters(field,bytes DESC,name);
      CREATE TABLE totals(id INTEGER PRIMARY KEY,requests INTEGER,bytes INTEGER,issues INTEGER,denied INTEGER,first INTEGER,last INTEGER,diagnostics INTEGER);
      INSERT INTO totals VALUES(1,0,0,0,0,NULL,NULL,0);
      CREATE TABLE timeline(epoch INTEGER PRIMARY KEY,requests INTEGER,bytes INTEGER);
      CREATE TABLE diagnostic_entries(id INTEGER PRIMARY KEY,record_id INTEGER,diagnostic TEXT NOT NULL);
      CREATE VIEW diagnostics AS SELECT e.id,CASE WHEN e.record_id IS NULL THEN e.diagnostic ELSE json_set(e.diagnostic,'$.rawLine',c.exception,'$.source',o.name) END AS diagnostic FROM diagnostic_entries e LEFT JOIN canonical c ON c.id=e.record_id LEFT JOIN sources o ON o.id=c.source_id;") .map_err(|e| e.to_string())
}
fn intern(
    tx: &Transaction<'_>,
    cache: &mut HashMap<(String, String), i64>,
    table: &str,
    column: &str,
    text: &str,
) -> Result<i64> {
    let key = (table.to_owned(), text.to_owned());
    if let Some(&id) = cache.get(&key) {
        return Ok(id);
    }
    // All identifiers come from module constants, never from log contents.
    tx.prepare_cached(&format!(
        "INSERT OR IGNORE INTO {table}({column}) VALUES(?)"
    ))
    .map_err(|e| e.to_string())?
    .execute([text])
    .map_err(|e| e.to_string())?;
    let id = tx
        .prepare_cached(&format!("SELECT id FROM {table} WHERE {column}=?"))
        .map_err(|e| e.to_string())?
        .query_row([text], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if cache.len() >= 16384 {
        cache.clear();
    }
    cache.insert(key, id);
    Ok(id)
}
fn field<'a>(r: &'a AccessLogRecord, name: &str) -> &'a str {
    r.raw_fields
        .get(name)
        .and_then(|v| v.value.as_deref())
        .unwrap_or("")
}
fn varint(mut n: u64, out: &mut Vec<u8>) {
    while n >= 128 {
        out.push(n as u8 | 128);
        n >>= 7;
    }
    out.push(n as u8);
}
fn read_varint(input: &mut &[u8]) -> Result<u64> {
    let mut n = 0u64;
    for shift in (0..=63).step_by(7) {
        let (&byte, rest) = input
            .split_first()
            .ok_or("Truncated traffic token integer")?;
        *input = rest;
        if shift == 63 && byte > 1 {
            return Err("Traffic token integer overflow".into());
        }
        n |= ((byte & 127) as u64) << shift;
        if byte < 128 {
            return Ok(n);
        }
    }
    Err("Invalid traffic token integer".into())
}
fn encode(tokens: &[String], refs: &HashMap<String, i64>) -> Vec<u8> {
    let mut out = vec![1];
    varint(tokens.len() as u64, &mut out);
    for token in tokens {
        if let Some(&id) = refs.get(token) {
            varint((id as u64) << 1 | 1, &mut out);
        } else {
            varint((token.len() as u64) << 1, &mut out);
            out.extend_from_slice(token.as_bytes());
        }
    }
    out
}
fn decode(mut input: &[u8], refs: &HashMap<i64, String>) -> Result<Vec<String>> {
    if input.first() != Some(&1) {
        return Err("Unsupported traffic token codec".into());
    }
    input = &input[1..];
    let count = usize::try_from(read_varint(&mut input)?).map_err(|e| e.to_string())?;
    // Every token requires at least one byte; reject corrupt counts before allocating.
    if count > input.len() {
        return Err("Invalid traffic token count".into());
    }
    let mut result = Vec::with_capacity(count);
    for _ in 0..count {
        let tag = read_varint(&mut input)?;
        if tag & 1 == 1 {
            result.push(
                refs.get(&((tag >> 1) as i64))
                    .ok_or("Missing traffic token dictionary entry")?
                    .clone(),
            );
        } else {
            let len = usize::try_from(tag >> 1).map_err(|e| e.to_string())?;
            if len > input.len() {
                return Err("Truncated traffic token".into());
            }
            result.push(
                std::str::from_utf8(&input[..len])
                    .map_err(|e| e.to_string())?
                    .to_owned(),
            );
            input = &input[len..];
        }
    }
    if !input.is_empty() {
        return Err("Trailing traffic token bytes".into());
    }
    Ok(result)
}
fn ambiguous(line: &str) -> bool {
    let mut quote = None;
    let mut escaped = false;
    for c in line.chars() {
        if let Some(q) = quote {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == q {
                quote = None;
            }
        } else if c == '\'' || c == '"' {
            quote = Some(c);
        }
    }
    quote.is_some()
}
fn refs(conn: &Connection) -> Result<HashMap<i64, String>> {
    conn.prepare("SELECT id,name FROM vals WHERE lexical=1")
        .map_err(|e| e.to_string())?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())
}

pub(crate) fn ingest(
    conn: &mut Connection,
    records: &[AccessLogRecord],
    diagnostics: &[AccessLogDiagnostic],
) -> Result<()> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut cache = HashMap::new();
    let mut lexical: HashMap<String, i64> = refs(&tx)?
        .into_iter()
        .map(|(id, name)| (name, id))
        .collect();
    let mut exceptional_ids: HashMap<(&str, &str), VecDeque<i64>> = HashMap::new();
    let mut counts: HashMap<(String, String), (i64, i64)> = HashMap::new();
    let mut minutes: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
    let (mut sum, mut error_sum, mut denied_sum) = (0i64, 0i64, 0i64);
    let (mut first, mut last): (Option<i64>, Option<i64>) = (None, None);
    for record in records {
        let schema = serde_json::to_string(&record.schema).map_err(|e| e.to_string())?;
        let schema_id = intern(&tx, &mut cache, "schemas", "fields", &schema)?;
        let source_id = intern(&tx, &mut cache, "sources", "name", &record.source)?;
        let sequence = record
            .id
            .strip_prefix(&format!("{}:", record.source))
            .and_then(|s| s.parse::<i64>().ok());
        let exception = record.malformed || ambiguous(&record.raw_line);
        let tokens = tokenize_elff(&record.raw_line);
        // Bounded, selective lexical dictionary; large/high-cardinality paths stay inline.
        for (i, token) in tokens.iter().enumerate() {
            let selected = record.schema.get(i).is_some_and(|name| {
                FIELDS.iter().any(|(f, _)| f == name) || name == "cs-categories"
            });
            if selected
                && token.len() <= 128
                && lexical.len() < TOKEN_DICTIONARY_LIMIT as usize
                && !lexical.contains_key(token)
            {
                let id = intern(&tx, &mut cache, "vals", "name", token)?;
                tx.execute("UPDATE vals SET lexical=1 WHERE id=?", [id])
                    .map_err(|e| e.to_string())?;
                lexical.insert(token.clone(), id);
            }
        }
        let payload = if exception {
            vec![1, 0]
        } else {
            encode(&tokens, &lexical)
        };
        tx.execute("INSERT INTO canonical(schema_id,source_id,sequence,original_id,tokens,exception) VALUES(?,?,?,?,?,?)",params![schema_id,source_id,sequence.unwrap_or(0),if sequence.is_none_or(|n|n<0 || record.id!=format!("{}:{n}",record.source)){Some(&record.id)}else{None},payload,if exception {Some(&record.raw_line)}else{None}]).map_err(|e|e.to_string())?;
        let id = tx.last_insert_rowid();
        if record.malformed {
            exceptional_ids
                .entry((&record.source, &record.raw_line))
                .or_default()
                .push_back(id);
        }
        let ts = epoch(record);
        let bytes: i64 = ["cs-bytes", "sc-bytes"]
            .iter()
            .filter_map(|n| field(record, n).parse::<i64>().ok())
            .filter(|n| *n >= 0)
            .try_fold(0i64, |a, b| a.checked_add(b))
            .ok_or("Traffic byte count overflow")?;
        let issue_list = issues(record);
        let denied = i64::from(
            issue_list
                .iter()
                .any(|s| s == "Denied transaction" || s == "Policy denial"),
        );
        let mut ids = Vec::new();
        for (name, _) in FIELDS {
            ids.push(intern(
                &tx,
                &mut cache,
                "vals",
                "name",
                field(record, name),
            )?);
        }
        let category_id = intern(
            &tx,
            &mut cache,
            "vals",
            "name",
            field(record, "cs-categories"),
        )?;
        tx.execute(
            "INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                id,
                ts,
                bytes,
                ids[0],
                ids[1],
                ids[2],
                category_id,
                ids[3],
                ids[4],
                ids[5],
                ids[6],
                ids[7],
                ids[8],
                ids[9],
                issue_list.len() as i64,
                denied,
                if ts.is_none() {
                    record.timestamp.as_deref()
                } else {
                    None
                }
            ],
        )
        .map_err(|e| e.to_string())?;
        // Ten scalar memberships live only in facts. Only actual multi-values need a bridge.
        for (name, _) in FIELDS {
            let val = field(record, name);
            if !val.is_empty() {
                let c = counts.entry((name.into(), val.into())).or_default();
                c.0 += 1;
                c.1 += bytes;
            }
        }
        let categories: HashSet<_> = field(record, "cs-categories")
            .split(';')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        for (code, name, values) in [
            (
                0,
                "cs-categories",
                categories
                    .into_iter()
                    .map(str::to_owned)
                    .collect::<Vec<_>>(),
            ),
            (1, "x-issue", issue_list.clone()),
        ] {
            for val in values {
                let value_id = intern(&tx, &mut cache, "vals", "name", &val)?;
                tx.execute(
                    "INSERT OR IGNORE INTO memberships VALUES(?,?,?)",
                    params![id, code, value_id],
                )
                .map_err(|e| e.to_string())?;
                let c = counts.entry((name.into(), val)).or_default();
                c.0 += 1;
                c.1 += bytes;
            }
        }
        sum = sum
            .checked_add(bytes)
            .ok_or("Traffic byte total overflow")?;
        error_sum += i64::from(!issue_list.is_empty());
        denied_sum += denied;
        if let Some(ts) = ts {
            first = Some(first.map_or(ts, |n| n.min(ts)));
            last = Some(last.map_or(ts, |n| n.max(ts)));
            let c = minutes.entry(ts.div_euclid(60000) * 60000).or_default();
            c.0 += 1;
            c.1 += bytes;
        }
    }
    for ((field, name), (requests, bytes)) in counts {
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO counters VALUES(?,?,0,0)",
                params![field, name],
            )
            .map_err(|e| e.to_string())?;
        if inserted > 0 {
            tx.execute("INSERT INTO counter_fields VALUES(?,1) ON CONFLICT(field) DO UPDATE SET unique_values=unique_values+1",[&field]).map_err(|e|e.to_string())?;
        }
        tx.execute(
            "UPDATE counters SET requests=requests+?,bytes=bytes+? WHERE field=? AND name=?",
            params![requests, bytes, field, name],
        )
        .map_err(|e| e.to_string())?;
    }
    for (minute, (requests, bytes)) in minutes {
        tx.execute("INSERT INTO timeline VALUES(?,?,?) ON CONFLICT(epoch) DO UPDATE SET requests=requests+excluded.requests,bytes=bytes+excluded.bytes",params![minute,requests,bytes]).map_err(|e|e.to_string())?;
    }
    tx.execute("UPDATE totals SET requests=requests+?,bytes=bytes+?,issues=issues+?,denied=denied+?,first=CASE WHEN first IS NULL THEN ? WHEN ? IS NULL THEN first ELSE MIN(first,?) END,last=CASE WHEN last IS NULL THEN ? WHEN ? IS NULL THEN last ELSE MAX(last,?) END,diagnostics=diagnostics+? WHERE id=1",params![records.len() as i64,sum,error_sum,denied_sum,first,first,first,last,last,last,diagnostics.len() as i64]).map_err(|e|e.to_string())?;
    // Link malformed diagnostics to the exceptional canonical line rather than copying it.
    // Schema-less input has no record, so its diagnostic remains the sole original source.
    for d in diagnostics {
        let record_id = exceptional_ids
            .get_mut(&(d.source.as_str(), d.raw_line.as_str()))
            .and_then(VecDeque::pop_front);
        let mut diagnostic = d.clone();
        if record_id.is_some() {
            diagnostic.raw_line.clear();
            diagnostic.source.clear();
        }
        tx.execute(
            "INSERT INTO diagnostic_entries(record_id,diagnostic) VALUES(?,?)",
            params![
                record_id,
                serde_json::to_string(&diagnostic).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn canonical_record(conn: &Connection, id: i64) -> Result<AccessLogRecord> {
    let (schema,source,sequence,original,payload,exception): (String,String,i64,Option<String>,Vec<u8>,Option<String>)=conn.query_row("SELECT s.fields,o.name,c.sequence,c.original_id,c.tokens,c.exception FROM canonical c JOIN schemas s ON s.id=c.schema_id JOIN sources o ON o.id=c.source_id WHERE c.id=?",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|e|e.to_string())?;
    let parser = AccessLogParser {
        fields: serde_json::from_str(&schema).map_err(|e| e.to_string())?,
    };
    let tokens = if let Some(raw) = &exception {
        tokenize_elff(raw)
    } else {
        decode(&payload, &refs(conn)?)?
    };
    let line = exception.clone().unwrap_or_else(|| tokens.join(" "));
    let (mut record, _) = parser.from_tokens(&line, &source, sequence as usize, tokens);
    if let Some(original) = original {
        record.id = original;
    }
    record.store_id = Some(id);
    record.raw_line_reconstructed = exception.is_none();
    Ok(record)
}
pub(crate) fn record(conn: &Connection, id: i64) -> Result<AccessLogRecord> {
    let mut record = canonical_record(conn, id)?;
    let mut stmt=conn.prepare("SELECT v.name FROM memberships m JOIN vals v ON v.id=m.value_id WHERE m.record_id=? AND m.field=1 ORDER BY v.name").map_err(|e|e.to_string())?;
    record.issues = stmt
        .query_map([id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| e.to_string())?;
    Ok(record)
}

/// Search retains v2 semantics (last duplicate field wins, field-name order,
/// interpreted values joined with spaces). No persistent concatenated search copy.
#[derive(Default)]
struct SearchPlan {
    positions: Vec<Vec<usize>>,
    threat: [Vec<usize>; 4],
}
fn borrowed_tokens<'a>(
    mut input: &'a [u8],
    dictionary: &'a HashMap<i64, String>,
) -> Result<Vec<&'a str>> {
    if input.first() != Some(&1) {
        return Err("Unsupported traffic token codec".into());
    }
    input = &input[1..];
    let count = usize::try_from(read_varint(&mut input)?).map_err(|e| e.to_string())?;
    if count > input.len() {
        return Err("Invalid traffic token count".into());
    }
    let mut tokens = Vec::with_capacity(count);
    for _ in 0..count {
        let tag = read_varint(&mut input)?;
        if tag & 1 == 1 {
            tokens.push(
                dictionary
                    .get(&((tag >> 1) as i64))
                    .ok_or("Missing traffic token dictionary entry")?
                    .as_str(),
            );
        } else {
            let len = usize::try_from(tag >> 1).map_err(|e| e.to_string())?;
            if len > input.len() {
                return Err("Truncated traffic token".into());
            }
            tokens.push(std::str::from_utf8(&input[..len]).map_err(|e| e.to_string())?);
            input = &input[len..];
        }
    }
    if !input.is_empty() {
        return Err("Trailing traffic token bytes".into());
    }
    Ok(tokens)
}
fn interpreted(token: &str) -> Option<Cow<'_, str>> {
    let quoted = token.len() >= 2
        && ((token.starts_with('"') && token.ends_with('"'))
            || (token.starts_with('\'') && token.ends_with('\'')));
    let text = if quoted {
        let inner = &token[1..token.len() - 1];
        if inner.contains('\\') {
            Cow::Owned(inner.replace("\\\"", "\"").replace("\\\\", "\\"))
        } else {
            Cow::Borrowed(inner)
        }
    } else {
        Cow::Borrowed(token)
    };
    if matches!(text.as_ref(), "" | "-" | "None" | "unavailable") {
        None
    } else {
        Some(text)
    }
}
pub(crate) fn register_search(conn: &Connection) -> Result<()> {
    let dictionary = Arc::new(refs(conn)?);
    let plans: Arc<Mutex<HashMap<String, Arc<SearchPlan>>>> = Arc::new(Mutex::new(HashMap::new()));
    for (name, threat) in [("traffic_search", false), ("traffic_threat", true)] {
        let dictionary = Arc::clone(&dictionary);
        let plans = Arc::clone(&plans);
        conn.create_scalar_function(
            name,
            3,
            rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            move |ctx| {
                let payload = ctx.get_raw(0).as_blob()?;
                let schema = ctx.get_raw(1).as_str()?;
                let exception: Option<String> = ctx.get(2)?;
                let run = || -> Result<String> {
                    let plan = {
                        let mut plans = plans.lock().map_err(|e| e.to_string())?;
                        if let Some(plan) = plans.get(schema) {
                            Arc::clone(plan)
                        } else {
                            let fields: Vec<String> =
                                serde_json::from_str(schema).map_err(|e| e.to_string())?;
                            let mut map = BTreeMap::new();
                            for (i, field) in fields.into_iter().enumerate() {
                                map.entry(field).or_insert_with(Vec::new).push(i);
                            }
                            let plan = Arc::new(SearchPlan {
                                positions: map.values().cloned().collect(),
                                threat: [
                                    "cs-threat-risk",
                                    "cs-threat-id",
                                    "rs-threat-id",
                                    "x-virus-id",
                                ]
                                .map(|f| map.get(f).cloned().unwrap_or_default()),
                            });
                            if plans.len() >= 128 {
                                plans.clear();
                            }
                            plans.insert(schema.into(), Arc::clone(&plan));
                            plan
                        }
                    };
                    let exceptional_tokens = exception.as_deref().map(tokenize_elff);
                    let tokens = if let Some(tokens) = &exceptional_tokens {
                        tokens.iter().map(String::as_str).collect()
                    } else {
                        borrowed_tokens(payload, &dictionary)?
                    };
                    if threat {
                        Ok(plan
                            .threat
                            .iter()
                            .map(|i| {
                                i.iter()
                                    .rev()
                                    .find(|&&i| i < tokens.len())
                                    .and_then(|&i| tokens.get(i))
                                    .and_then(|s| interpreted(s))
                                    .unwrap_or(Cow::Borrowed(""))
                            })
                            .collect::<Vec<_>>()
                            .join(" "))
                    } else {
                        let mut result = String::new();
                        for positions in &plan.positions {
                            if let Some(text) = positions
                                .iter()
                                .rev()
                                .find(|&&i| i < tokens.len())
                                .and_then(|&i| tokens.get(i))
                                .and_then(|s| interpreted(s))
                            {
                                if !result.is_empty() {
                                    result.push(' ');
                                }
                                result.push_str(&text);
                            }
                        }
                        Ok(result)
                    }
                };
                run().map_err(|e| {
                    rusqlite::Error::UserFunctionError(std::io::Error::other(e).into())
                })
            },
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::traffic_analysis::semantic_value;
    pub(crate) fn database() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES('version','3');").unwrap();
        create(&c).unwrap();
        c
    }
    pub(crate) fn sample() -> Vec<AccessLogRecord> {
        let parser=AccessLogParser{fields:"date time c-ip cs-username cs-host cs-method sc-status s-action cs-categories cs-bytes sc-bytes cs-uri-path".split_whitespace().map(str::to_owned).collect()};
        [
            "2026-01-01 00:00:00 192.0.2.1 alice a.example GET 200 TCP_HIT \"News;Tech;News\" 10 20 /one",
            "2026-01-01 00:00:01 192.0.2.2 bob b.example POST 403 DENIED Tech 30 40 /two",
            "2026-01-01 00:01:00 192.0.2.1 - a.example GET 500 ERROR - 50 60 /three",
        ].iter().enumerate().map(|(i,l)|parser.parse_line(l,"fixture",i+1).unwrap().0).collect()
    }
    #[test]
    fn canonical_roundtrip_preserves_tokens_fields_and_history() {
        let mut conn = database();
        let mut records = sample();
        let schema = AccessLogParser {
            fields: vec![
                "cs-host".into(),
                "cs-uri-path".into(),
                "custom".into(),
                "absent".into(),
            ],
        };
        records.push(
            schema
                .parse_line(
                    "'hello world' \"a\\\"b\\\\c\" None unavailable",
                    "other.log",
                    42,
                )
                .unwrap()
                .0,
        );
        records.push(schema.parse_line("x y -", "other.log", 43).unwrap().0); // missing
        records.push(
            schema
                .parse_line("x y - unavailable extra", "other.log", 44)
                .unwrap()
                .0,
        );
        records.push(
            schema
                .parse_line("x y - \"unclosed", "other.log", 45)
                .unwrap()
                .0,
        );
        ingest(&mut conn, &records, &[]).unwrap();
        for (i, original) in records.iter().enumerate() {
            let actual = record(&conn, (i + 1) as i64).unwrap();
            assert_eq!(actual.id, original.id);
            assert_eq!(actual.schema, original.schema);
            assert_eq!(
                serde_json::to_value(&actual.raw_fields).unwrap(),
                serde_json::to_value(&original.raw_fields).unwrap()
            );
            assert_eq!(
                serde_json::to_value(&actual.normalized).unwrap(),
                serde_json::to_value(&original.normalized).unwrap()
            );
            assert_eq!(actual.issues, issues(original));
            assert_eq!(
                tokenize_elff(&actual.raw_line),
                tokenize_elff(&original.raw_line)
            );
        }
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM canonical WHERE exception IS NOT NULL",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            3
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM memberships WHERE field=0 AND record_id=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
        assert!(conn.prepare("SELECT record FROM records").is_err());
        assert!(conn.prepare("SELECT search FROM records").is_err());
        assert!(conn.prepare("SELECT * FROM dimensions").is_err());
    }
    #[test]
    fn codec_rejects_corruption_and_bounds_allocations() {
        let dictionary = HashMap::from([(1, "GET".into())]);
        let tokens = vec!["GET".into(), "".into(), "á😀".into(), "\\\"".into()];
        let encoded = encode(&tokens, &HashMap::from([("GET".into(), 1)]));
        assert_eq!(decode(&encoded, &dictionary).unwrap(), tokens);
        for input in [
            &[][..],
            &[2, 0],
            &[1, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
            &[1, 1, 3],
            &[1, 1, 10, 65],
            &[1, 0, 0],
        ] {
            assert!(decode(input, &HashMap::new()).is_err(), "{input:?}");
        }
    }
    #[test]
    fn search_matches_v2_interpretation_including_literal_wildcards() {
        let mut c = database();
        let mut rows = sample();
        rows[0].raw_line = rows[0].raw_line.replace("/one", "/100%_done");
        // Reparse so the canonical source and derived fields agree.
        rows[0] = AccessLogParser {
            fields: rows[0].schema.clone(),
        }
        .parse_line(&rows[0].raw_line, "fixture", 1)
        .unwrap()
        .0;
        ingest(&mut c, &rows, &[]).unwrap();
        register_search(&c).unwrap();
        for (i, r) in rows.iter().enumerate() {
            let expected = r
                .raw_fields
                .values()
                .filter_map(|v| v.value.as_deref())
                .collect::<Vec<_>>()
                .join(" ");
            let actual:String=c.query_row("SELECT traffic_search(c.tokens,s.fields,c.exception) FROM canonical c JOIN schemas s ON s.id=c.schema_id WHERE c.id=?",[(i+1) as i64],|r|r.get(0)).unwrap();
            assert_eq!(actual, expected);
        }
    }
    #[test]
    fn failed_batch_rolls_back_source_dictionary_and_projection() {
        let mut c = database();
        let mut rows = sample();
        rows[1]
            .raw_fields
            .insert("cs-bytes".into(), semantic_value(i64::MAX.to_string()));
        assert!(ingest(&mut c, &rows, &[]).is_err());
        for table in ["records", "canonical", "memberships", "counters"] {
            assert_eq!(
                c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
    #[test]
    fn source_can_regenerate_projection_without_reading_old_facts() {
        let mut source = database();
        let rows = sample();
        ingest(&mut source, &rows, &[]).unwrap();
        source.execute_batch("DELETE FROM records;DELETE FROM memberships;DELETE FROM counters;DELETE FROM counter_fields;DELETE FROM timeline;").unwrap();
        let recovered = (1..=rows.len())
            .map(|i| canonical_record(&source, i as i64).unwrap())
            .collect::<Vec<_>>();
        let mut target = database();
        ingest(&mut target, &recovered, &[]).unwrap();
        for (i, r) in rows.iter().enumerate() {
            let rebuilt = record(&target, (i + 1) as i64).unwrap();
            assert_eq!(rebuilt.issues, issues(r));
            assert_eq!(
                serde_json::to_value(rebuilt.raw_fields).unwrap(),
                serde_json::to_value(&r.raw_fields).unwrap()
            );
        }
    }
    #[test]
    fn duplicate_fields_missing_values_and_escape_search_match_parser() {
        let p = AccessLogParser {
            fields: vec!["x".into(), "a".into(), "x".into()],
        };
        let mut rows = Vec::new();
        for (i, line) in [
            "first second",
            "first \"a\\\"b\\\\c\" last",
            "None unavailable -",
            "\"\" '\"' x",
        ]
        .iter()
        .enumerate()
        {
            rows.push(p.parse_line(line, "duplicates", i + 1).unwrap().0);
        }
        let mut c = database();
        ingest(&mut c, &rows, &[]).unwrap();
        register_search(&c).unwrap();
        for (i, r) in rows.iter().enumerate() {
            let expected = r
                .raw_fields
                .values()
                .filter_map(|v| v.value.as_deref())
                .collect::<Vec<_>>()
                .join(" ");
            let actual:String=c.query_row("SELECT traffic_search(c.tokens,s.fields,c.exception) FROM canonical c JOIN schemas s ON s.id=c.schema_id WHERE c.id=?",[(i+1) as i64],|r|r.get(0)).unwrap();
            assert_eq!(actual, expected);
        }
    }
    #[test]
    fn diagnostics_reference_one_exceptional_source() {
        let p = AccessLogParser {
            fields: vec!["a".into(), "b".into()],
        };
        let (row, diagnostic) = p.parse_line("only-one", "malformed", 1).unwrap();
        let diagnostic = diagnostic.unwrap();
        let mut c = database();
        ingest(&mut c, &[row], &[diagnostic.clone()]).unwrap();
        let stored: String = c
            .query_row("SELECT diagnostic FROM diagnostic_entries", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!stored.contains("only-one"));
        let rendered: String = c
            .query_row("SELECT diagnostic FROM diagnostics", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered).unwrap(),
            serde_json::to_value(diagnostic).unwrap()
        );
    }
    #[test]
    fn persisted_codec_v1_fixture_keeps_missing_and_explicit_none_distinct() {
        let c = database();
        c.execute(
            "INSERT INTO schemas VALUES(1,?)",
            [r#"["c-ip","cs-username"]"#],
        )
        .unwrap();
        c.execute("INSERT INTO sources VALUES(1,'fixture-v1')", [])
            .unwrap();
        // Version 1, two literal tokens: '-' and 'None'. This is deliberately not encoded by the current writer.
        let payload: &[u8] = &[1, 2, 2, b'-', 8, b'N', b'o', b'n', b'e'];
        c.execute(
            "INSERT INTO canonical VALUES(1,1,1,7,NULL,?,NULL)",
            [payload],
        )
        .unwrap();
        let r = canonical_record(&c, 1).unwrap();
        assert_eq!(r.id, "fixture-v1:7");
        assert_eq!(r.raw_fields["c-ip"].raw, "-");
        assert_eq!(r.raw_fields["c-ip"].availability, "missing");
        assert_eq!(r.raw_fields["cs-username"].availability, "explicit-none");
        assert_eq!(r.normalized["client.ip"].value, None);
        assert_eq!(r.normalized["user.name"].value, None);
    }
}
