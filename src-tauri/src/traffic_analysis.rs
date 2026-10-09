use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::Manager;
use tauri::{AppHandle, State};

const MOCK_ACCESS_LOG: &str = include_str!("../fixtures/mock_accesslog_main.log");

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLogValue {
    pub raw: String,
    pub value: Option<String>,
    pub availability: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLogRecord {
    #[serde(default)]
    pub issues: Vec<String>,
    pub id: String,
    pub source: String,
    pub schema: Vec<String>,
    pub raw_line: String,
    pub raw_fields: BTreeMap<String, AccessLogValue>,
    pub normalized: BTreeMap<String, AccessLogValue>,
    pub timestamp: Option<String>,
    pub malformed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLogDiagnostic {
    pub expected_fields: usize,
    pub received_values: usize,
    pub source: String,
    pub raw_line: String,
    pub error_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldAvailability {
    pub name: String,
    pub status: String,
    pub populated: usize,
    pub total: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficBucket {
    pub epoch: i64,
    pub requests: usize,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLogDataset {
    #[serde(default)]
    pub capture_id: Option<String>,
    pub source: String,
    pub timeline: Vec<TrafficBucket>,
    pub fields: Vec<String>,
    pub records: Vec<AccessLogRecord>,
    pub diagnostics: Vec<AccessLogDiagnostic>,
    pub field_availability: Vec<FieldAvailability>,
    pub received_lines: usize,
    pub records_processed: usize,
    pub bytes_processed: u64,
    pub diagnostics_total: usize,
}

#[derive(Default)]
pub struct AccessLogParseState(pub(crate) Arc<Mutex<HashMap<String, ParseSession>>>);

impl AccessLogParseState {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, ParseSession>>, String> {
        self.0
            .lock()
            .map_err(|_| "Access log parser state is unavailable.".to_string())
    }
}

#[derive(Default)]
pub(crate) struct ParseSession {
    source: String,
    record_source: Option<String>,
    parser: AccessLogParser,
    carry: String,
    fields: Vec<String>,
    availability: HashMap<String, (usize, usize)>,
    received_lines: usize,
    records_processed: usize,
    bytes_processed: u64,
    diagnostics_total: usize,
    workers: usize,
    store: Option<crate::traffic_store::CaptureStore>,
    timeline: BTreeMap<i64, (usize, u64)>,
    archive: Option<std::fs::File>,
    archive_path: Option<std::path::PathBuf>,
    completed: Option<AccessLogDataset>,
    tail: VecDeque<AccessLogRecord>,
}

pub(crate) fn create_capture_session(
    app: &AppHandle,
    source: String,
    workers: Option<usize>,
) -> Result<(String, ParseSession), String> {
    let id = format!(
        "static-{}-{}",
        Utc::now().timestamp_micros(),
        NEXT_PARSE_ID.fetch_add(1, Ordering::Relaxed)
    );
    let config = get_traffic_processing_config();
    let mut session = ParseSession::default();
    session.store = Some(crate::traffic_store::CaptureStore::create(
        app,
        id.clone(),
        &source,
    )?);
    session.source = source;
    session.workers = workers
        .unwrap_or(config.recommended_workers)
        .clamp(1, config.max_workers);
    Ok((id, session))
}

pub(crate) fn complete_capture_session(
    session: &mut ParseSession,
) -> Result<AccessLogDataset, String> {
    let dataset = parse_session_chunk(session, "", true)?;
    if let Some(store) = &session.store {
        store.complete()?;
    }
    session.completed = Some(dataset.clone());
    Ok(dataset)
}

impl ParseSession {
    fn cleanup(&mut self) {
        self.archive.take();
        if let Some(path) = self.archive_path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

impl Drop for ParseSession {
    fn drop(&mut self) {
        self.cleanup();
    }
}

fn add_timeline(map: &mut BTreeMap<i64, (usize, u64)>, record: &AccessLogRecord) {
    if let Some(epoch) = record
        .timestamp
        .as_deref()
        .and_then(|value| chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").ok())
        .map(|date| date.and_utc().timestamp_millis())
    {
        let counts = map.entry(epoch.div_euclid(60000) * 60000).or_default();
        counts.0 += 1;
        counts.1 += ["cs-bytes", "sc-bytes"]
            .iter()
            .filter_map(|name| {
                record
                    .raw_fields
                    .get(*name)?
                    .value
                    .as_deref()?
                    .parse::<u64>()
                    .ok()
            })
            .sum::<u64>();
    }
}
fn timeline_values(map: &BTreeMap<i64, (usize, u64)>) -> Vec<TrafficBucket> {
    map.iter()
        .map(|(&epoch, &(requests, bytes))| TrafficBucket {
            epoch,
            requests,
            bytes,
        })
        .collect()
}

static NEXT_PARSE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Default)]
struct AccessLogParser {
    fields: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficProcessingConfig {
    logical_cpus: usize,
    recommended_workers: usize,
    max_workers: usize,
    chunk_bytes: usize,
}

#[tauri::command]
pub fn get_traffic_processing_config() -> TrafficProcessingConfig {
    let logical_cpus = std::thread::available_parallelism().map_or(1, |count| count.get());
    TrafficProcessingConfig {
        logical_cpus,
        recommended_workers: logical_cpus.saturating_sub(1).clamp(1, 8),
        max_workers: logical_cpus.min(16),
        chunk_bytes: 8 * 1024 * 1024,
    }
}

impl AccessLogParser {
    fn set_fields(&mut self, line: &str) -> bool {
        let Some((_, schema)) = line.split_once("#Fields:") else {
            return false;
        };
        self.fields = schema.split_whitespace().map(str::to_owned).collect();
        true
    }

    fn parse_line(
        &self,
        raw_line: &str,
        source: &str,
        sequence: usize,
    ) -> Option<(AccessLogRecord, Option<AccessLogDiagnostic>)> {
        if raw_line.trim().is_empty()
            || raw_line.trim_start().starts_with('#')
            || self.fields.is_empty()
        {
            return None;
        }
        let tokens = tokenize_elff(raw_line);
        let malformed = tokens.len() != self.fields.len();
        let mut raw_fields = BTreeMap::new();
        let mut normalized = BTreeMap::new();
        for (index, name) in self.fields.iter().enumerate().take(tokens.len()) {
            let value = semantic_value(tokens[index].clone());
            raw_fields.insert(name.clone(), value.clone());
            if let Some(normalized_name) = normalized_name(name) {
                normalized.insert(normalized_name.to_string(), value);
            }
        }
        let date = raw_fields.get("date").and_then(|field| field.value.clone());
        let time = raw_fields.get("time").and_then(|field| field.value.clone());
        let timestamp = date.zip(time).map(|(date, time)| format!("{date} {time}"));
        let diagnostic = malformed.then(|| AccessLogDiagnostic {
            expected_fields: self.fields.len(),
            received_values: tokens.len(),
            source: source.to_string(),
            raw_line: raw_line.to_string(),
            error_type: if tokens.len() < self.fields.len() {
                "missing_values"
            } else {
                "extra_values"
            }
            .to_string(),
        });
        Some((
            AccessLogRecord {
                issues: Vec::new(),
                id: format!("{source}:{sequence}"),
                source: source.to_string(),
                schema: self.fields.clone(),
                raw_line: raw_line.to_string(),
                raw_fields,
                normalized,
                timestamp,
                malformed,
            },
            diagnostic,
        ))
    }
}

fn tokenize_elff(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for character in line.chars() {
        if let Some(delimiter) = quote {
            current.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == delimiter {
                quote = None;
            }
        } else if character == '"' || character == '\'' {
            quote = Some(character);
            current.push(character);
        } else if character.is_whitespace() {
            if !current.is_empty() {
                values.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if !current.is_empty() {
        values.push(current);
    }
    values
}

fn semantic_value(raw: String) -> AccessLogValue {
    let unquoted = if raw.len() >= 2
        && ((raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\'')))
    {
        raw[1..raw.len() - 1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    } else {
        raw.clone()
    };
    let availability = match unquoted.as_str() {
        "" => "empty",
        "-" => "missing",
        "None" => "explicit-none",
        "unavailable" => "unavailable",
        _ => "value",
    };
    let value = if availability == "value" {
        Some(unquoted)
    } else {
        None
    };
    AccessLogValue {
        raw,
        value,
        availability: availability.to_string(),
    }
}

fn normalized_name(field: &str) -> Option<&'static str> {
    Some(match field {
        "date" | "time" => {
            if field == "date" {
                "time.date"
            } else {
                "time.clock"
            }
        }
        "time-taken" => "transaction.duration_ms",
        "c-ip" => "client.ip",
        "cs-username" => "user.name",
        "cs-auth-group" => "user.group",
        "cs-categories" => "security.categories",
        "cs-host" => "request.host",
        "cs-uri-scheme" => "request.scheme",
        "cs-uri-port" => "request.port",
        "cs-uri-path" => "request.path",
        "cs-uri-query" => "request.query",
        "cs-uri-extension" => "request.extension",
        "cs-method" => "request.method",
        "cs(Referer)" => "request.referer",
        "cs(User-Agent)" => "request.user_agent",
        "sc-status" => "response.status",
        "rs(Content-Type)" => "response.content_type",
        "s-action" => "transaction.action",
        "x-exception-id" => "transaction.exception",
        "s-ip" => "proxy.ip",
        "cs-bytes" => "traffic.client_bytes",
        "sc-bytes" => "traffic.server_bytes",
        "cs-threat-risk" => "security.threat_risk",
        "x-virus-id" => "security.virus_id",
        "cs-threat-id" => "security.client_threat_id",
        "rs-threat-id" => "security.server_threat_id",
        "cs-threat-source" => "security.client_threat_source",
        "rs-threat-source" => "security.server_threat_source",
        "x-bluecoat-application-name" => "application.name",
        "x-bluecoat-application-operation" => "application.operation",
        "x-bluecoat-application-groups" => "application.groups",
        "x-bluecoat-access-security-policy-action" => "policy.action",
        "x-bluecoat-access-security-policy-reason" => "policy.reason",
        "x-bluecoat-transaction-uuid" => "transaction.uuid",
        "x-ssl-client-certificate-subject" => "ssl.client_certificate_subject",
        "x-ssl-server-certificate-subject" => "ssl.server_certificate_subject",
        "x-ssl-certificate-subject" => "ssl.certificate_subject",
        "x-ssl-certificate-issuer" => "ssl.certificate_issuer",
        "x-ssl-certificate-serial-number" => "ssl.certificate_serial_number",
        "x-ssl-certificate-validation-result" => "ssl.certificate_validation",
        "x-ssl-certificate-validation-status" => "ssl.certificate_validation",
        "x-ssl-version" => "ssl.version",
        "x-ssl-cipher-suite" => "ssl.cipher_suite",
        "x-ssl-server-name" => "ssl.server_name",
        "x-ocsp-status" => "ssl.ocsp_status",
        "x-icap-error" => "icap.error",
        "x-icap-reqmod-header(X-ICAP-Metadata)" => "icap.request_metadata",
        "x-icap-respmod-header(X-ICAP-Metadata)" => "icap.response_metadata",
        _ => return None,
    })
}

fn make_dataset(source: &str, content: &str) -> AccessLogDataset {
    let mut parser = AccessLogParser::default();
    let mut fields = Vec::new();
    let mut records = Vec::new();
    let mut diagnostics = Vec::new();
    let mut received_lines = 0;
    for line in content.lines() {
        let line = line.trim_start_matches('\u{feff}');
        if parser.set_fields(line) {
            for field in &parser.fields {
                if !fields.contains(field) {
                    fields.push(field.clone());
                }
            }
            continue;
        }
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        received_lines += 1;
        if parser.fields.is_empty() {
            diagnostics.push(AccessLogDiagnostic {
                expected_fields: 0,
                received_values: tokenize_elff(line).len(),
                source: source.to_string(),
                raw_line: line.to_string(),
                error_type: "schema_missing".to_string(),
            });
            continue;
        }
        if let Some((record, diagnostic)) = parser.parse_line(line, source, received_lines) {
            records.push(record);
            if let Some(diagnostic) = diagnostic {
                diagnostics.push(diagnostic);
            }
        }
    }
    let field_availability = fields
        .iter()
        .map(|name| {
            let present = records
                .iter()
                .filter(|record| record.schema.contains(name))
                .count();
            let populated = records
                .iter()
                .filter(|record| {
                    record
                        .raw_fields
                        .get(name)
                        .is_some_and(|value| value.availability == "value")
                })
                .count();
            FieldAvailability {
                name: name.clone(),
                status: if populated > 0 {
                    "populated"
                } else if present > 0 {
                    "present-empty"
                } else {
                    "not-in-log"
                }
                .to_string(),
                populated,
                total: present,
            }
        })
        .collect();
    let records_processed = records.len();
    let diagnostics_total = diagnostics.len();
    let bytes_processed = records
        .iter()
        .map(|record| {
            ["cs-bytes", "sc-bytes"]
                .iter()
                .filter_map(|name| {
                    record
                        .raw_fields
                        .get(*name)?
                        .value
                        .as_deref()?
                        .parse::<u64>()
                        .ok()
                })
                .sum::<u64>()
        })
        .sum();
    let mut timeline = BTreeMap::new();
    for record in &records {
        add_timeline(&mut timeline, record);
    }
    AccessLogDataset {
        capture_id: None,
        timeline: timeline_values(&timeline),
        source: source.to_string(),
        fields,
        records,
        diagnostics,
        field_availability,
        received_lines,
        records_processed,
        bytes_processed,
        diagnostics_total,
    }
}

#[tauri::command]
pub fn parse_access_log(content: String, source: String) -> AccessLogDataset {
    make_dataset(&source, &content)
}

#[tauri::command]
pub fn start_access_log_parse(
    app: AppHandle,
    source: String,
    workers: Option<usize>,
    state: State<'_, AccessLogParseState>,
) -> Result<String, String> {
    let (id, session) = create_capture_session(&app, source.clone(), workers)?;
    let log_source = source.clone();
    let config = get_traffic_processing_config();
    let workers = workers
        .unwrap_or(config.recommended_workers)
        .clamp(1, config.max_workers);
    state.lock()?.insert(id.clone(), session);
    eprintln!(
        "[traffic-analysis] parse_started id={} source={} workers={} logical_cpus={}",
        id, log_source, workers, config.logical_cpus
    );
    Ok(id)
}

#[tauri::command]
pub async fn append_access_log_parse_chunk(
    parse_id: String,
    chunk: String,
    is_final: bool,
    file_source: Option<String>,
    is_file_start: Option<bool>,
    is_file_end: Option<bool>,
    state: State<'_, AccessLogParseState>,
) -> Result<AccessLogDataset, String> {
    let sessions = Arc::clone(&state.0);
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions.lock().map_err(|_| "Access log parser state is unavailable.".to_string())?;
        let session = sessions.get_mut(&parse_id).ok_or_else(|| "The access log parse session expired.".to_string())?;
        if is_file_start.unwrap_or(false) {
            if !session.carry.is_empty() { return Err("Finish the previous log file before starting another.".into()); }
            session.parser = AccessLogParser::default();
            session.record_source = file_source;
        }
        let started = std::time::Instant::now();
        let dataset = parse_session_chunk(session, &chunk, is_final || is_file_end.unwrap_or(false))?;
        if is_file_end.unwrap_or(false) { session.parser = AccessLogParser::default(); }
        eprintln!("[traffic-analysis] source={} chunk_bytes={} final={} workers={} elapsed_ms={} fields={} received_lines={} parsed_records={} malformed={} traffic_bytes={}", dataset.source, chunk.len(), is_final, session.workers, started.elapsed().as_millis(), dataset.fields.len(), dataset.received_lines, dataset.records_processed, dataset.diagnostics_total, dataset.bytes_processed);
        if is_final {
            if let Some(store) = &session.store { store.complete()?; }
            if let Some(file) = session.archive.as_mut() { file.sync_all().map_err(|e| format!("Could not flush processed log: {e}"))?; }
            let mut snapshot = dataset.clone();
            snapshot.records = session.tail.iter().cloned().collect();
            session.completed = Some(snapshot);
        }
        Ok(dataset)
    }).await.map_err(|error| format!("Access log processing task failed: {error}"))?
}

pub(crate) fn parse_session_chunk(
    session: &mut ParseSession,
    chunk: &str,
    is_final: bool,
) -> Result<AccessLogDataset, String> {
    if session.completed.is_some() {
        return Err("This parse session is already complete.".into());
    }
    let source = session.source.clone();
    let mut data = std::mem::take(&mut session.carry);
    data.push_str(chunk);

    let complete_end = if is_final {
        data.len()
    } else {
        data.rfind('\n').map_or(0, |index| index + 1)
    };
    let incomplete = data.split_off(complete_end);
    session.carry = incomplete;

    let record_source = session.record_source.clone().unwrap_or_else(|| source.clone());
    let (records, diagnostics) = consume_access_log_block(session, &data, &record_source)?;

    let field_availability = session
        .fields
        .iter()
        .map(|name| {
            let (total, populated) = session.availability.get(name).copied().unwrap_or_default();
            FieldAvailability {
                name: name.clone(),
                status: if populated > 0 {
                    "populated"
                } else if session.availability.contains_key(name) {
                    "present-empty"
                } else {
                    "not-in-log"
                }
                .to_string(),
                populated,
                total,
            }
        })
        .collect();
    session.tail.extend(records.iter().cloned());
    while session.tail.len() > 5000 {
        session.tail.pop_front();
    }
    let dataset = AccessLogDataset {
        capture_id: session.store.as_ref().map(|store| store.id.clone()),
        timeline: timeline_values(&session.timeline),
        source: source.clone(),
        fields: session.fields.clone(),
        records,
        diagnostics,
        diagnostics_total: session.diagnostics_total,
        field_availability,
        received_lines: session.received_lines,
        records_processed: session.records_processed,
        bytes_processed: session.bytes_processed,
    };
    if let Some(store) = &session.store {
        store.snapshot(&dataset)?;
    }
    Ok(dataset)
}

#[tauri::command]
pub fn abort_access_log_parse(
    parse_id: String,
    state: State<'_, AccessLogParseState>,
) -> Result<(), String> {
    if let Some(mut session) = state.lock()?.remove(&parse_id) {
        session.cleanup();
        eprintln!(
            "[traffic-analysis] parse_aborted id={} source={} received_lines={} parsed_records={}",
            parse_id, session.source, session.received_lines, session.records_processed
        );
    }
    Ok(())
}

struct ParseJob<'a> {
    line: &'a str,
    parser: Arc<AccessLogParser>,
    sequence: usize,
}

#[derive(Default)]
struct ParsedBatch {
    timeline: BTreeMap<i64, (usize, u64)>,
    archive_rows: Vec<u8>,
    records: VecDeque<AccessLogRecord>,
    diagnostics: VecDeque<AccessLogDiagnostic>,
    availability: HashMap<String, (usize, usize)>,
    records_processed: usize,
    bytes_processed: u64,
    diagnostics_total: usize,
}

fn parse_jobs(
    jobs: &[ParseJob<'_>],
    source: &str,
    archive: bool,
    indexed: bool,
) -> Result<ParsedBatch, String> {
    let mut result = ParsedBatch::default();
    for job in jobs {
        let (record, diagnostic) = if job.parser.fields.is_empty() {
            (
                None,
                Some(AccessLogDiagnostic {
                    expected_fields: 0,
                    received_values: tokenize_elff(job.line).len(),
                    source: source.to_string(),
                    raw_line: job.line.to_string(),
                    error_type: "schema_missing".to_string(),
                }),
            )
        } else {
            job.parser
                .parse_line(job.line, source, job.sequence)
                .map_or((None, None), |(record, diagnostic)| {
                    (Some(record), diagnostic)
                })
        };
        if let Some(record) = record {
            add_timeline(&mut result.timeline, &record);
            if archive {
                serde_json::to_writer(&mut result.archive_rows, &record)
                    .map_err(|e| format!("Could not encode processed record: {e}"))?;
                result.archive_rows.push(b'\n');
            }
            for field in &record.schema {
                let populated = usize::from(
                    record
                        .raw_fields
                        .get(field)
                        .is_some_and(|value| value.availability == "value"),
                );
                if let Some(counts) = result.availability.get_mut(field) {
                    counts.0 += 1;
                    counts.1 += populated;
                } else {
                    result.availability.insert(field.clone(), (1, populated));
                }
            }
            result.bytes_processed += ["cs-bytes", "sc-bytes"]
                .iter()
                .filter_map(|name| {
                    record
                        .raw_fields
                        .get(*name)?
                        .value
                        .as_deref()?
                        .parse::<u64>()
                        .ok()
                })
                .sum::<u64>();
            result.records_processed += 1;
            if !indexed && result.records.len() == 5000 {
                result.records.pop_front();
            }
            result.records.push_back(record);
        }
        if let Some(diagnostic) = diagnostic {
            if archive {
                serde_json::to_writer(
                    &mut result.archive_rows,
                    &serde_json::json!({ "diagnostic": diagnostic }),
                )
                .map_err(|e| format!("Could not encode parser diagnostic: {e}"))?;
                result.archive_rows.push(b'\n');
            }
            result.diagnostics_total += 1;
            if !indexed && result.diagnostics.len() == 200 {
                result.diagnostics.pop_front();
            }
            result.diagnostics.push_back(diagnostic);
        }
    }
    Ok(result)
}

fn consume_access_log_block(
    session: &mut ParseSession,
    data: &str,
    source: &str,
) -> Result<(Vec<AccessLogRecord>, Vec<AccessLogDiagnostic>), String> {
    // Headers and line boundaries are coordinated in file order. Each worker receives
    // the immutable schema that was active at that specific row, including schema changes.
    let mut parser = Arc::new(session.parser.clone());
    let mut jobs = Vec::new();
    for line in data.split_terminator('\n') {
        let line = line.trim_end_matches('\r').trim_start_matches('\u{feff}');
        if session.parser.set_fields(line) {
            for field in &session.parser.fields {
                if !session.fields.contains(field) {
                    session.fields.push(field.clone());
                }
                session.availability.entry(field.clone()).or_insert((0, 0));
            }
            parser = Arc::new(session.parser.clone());
        } else if !line.trim().is_empty() && !line.trim_start().starts_with('#') {
            session.received_lines += 1;
            jobs.push(ParseJob {
                line,
                parser: Arc::clone(&parser),
                sequence: session.received_lines,
            });
        }
    }
    let workers = session.workers.max(1).min(jobs.len().max(1));
    let archive = session.archive.is_some();
    let indexed = session.store.is_some();
    let parsed = if workers == 1 || jobs.len() < 256 {
        vec![parse_jobs(&jobs, source, archive, indexed)?]
    } else {
        std::thread::scope(|scope| {
            let handles: Vec<_> = jobs
                .chunks(jobs.len().div_ceil(workers))
                .map(|batch| scope.spawn(move || parse_jobs(batch, source, archive, indexed)))
                .collect();
            let mut parsed = Vec::with_capacity(handles.len());
            for handle in handles {
                parsed.push(
                    handle
                        .join()
                        .map_err(|_| "An access log parser worker failed.".to_string())??,
                );
            }
            Ok::<_, String>(parsed)
        })?
    };
    let mut records = Vec::new();
    let mut diagnostics = Vec::new();
    for mut batch in parsed {
        if let Some(store) = &mut session.store {
            store.ingest(
                batch.records.make_contiguous(),
                batch.diagnostics.make_contiguous(),
            )?;
        }
        if let Some(file) = session.archive.as_mut() {
            file.write_all(&batch.archive_rows).map_err(|e| {
                format!("Could not write processed log (check free disk space): {e}")
            })?;
        }
        for (epoch, (requests, bytes)) in batch.timeline {
            let counts = session.timeline.entry(epoch).or_default();
            counts.0 += requests;
            counts.1 += bytes;
        }
        for (field, (total, populated)) in batch.availability {
            let counts = session.availability.entry(field).or_default();
            counts.0 += total;
            counts.1 += populated;
        }
        session.bytes_processed += batch.bytes_processed;
        session.records_processed += batch.records_processed;
        session.diagnostics_total += batch.diagnostics_total;
        if !indexed {
            records.extend(batch.records);
            diagnostics.extend(batch.diagnostics);
        }
    }
    // Captured sessions persist complete batches and send metadata through IPC.
    // The standalone compatibility parser retains a bounded preview only.
    if records.len() > 5000 {
        records.drain(..records.len() - 5000);
    }
    if diagnostics.len() > 200 {
        diagnostics.drain(..diagnostics.len() - 200);
    }
    Ok((records, diagnostics))
}

#[tauri::command]
pub fn get_mock_access_log(chart: Option<bool>) -> String {
    if chart.unwrap_or(false) {
        include_str!("../fixtures/chart_sample.txt").to_string()
    } else {
        MOCK_ACCESS_LOG.to_string()
    }
}

const ARCHIVE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedTrafficAnalysis {
    version: u32,
    saved_at: String,
    dataset: AccessLogDataset,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrafficArchiveInfo {
    id: String,
    source: String,
    records: usize,
    saved_at: String,
    path: String,
}

fn traffic_archive_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("traffic-analysis");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn archive_path(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if !id.starts_with("static-") || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid processed log identifier.".into());
    }
    Ok(traffic_archive_dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
pub async fn save_traffic_analysis(
    app: AppHandle,
    parse_id: String,
    state: State<'_, AccessLogParseState>,
) -> Result<String, String> {
    let sessions = Arc::clone(&state.0);
    if crate::traffic_store::path(&app, &parse_id)?.is_file() {
        return tokio::task::spawn_blocking(move || {
            // Serialize Save with session disposal, including navigation cleanup.
            let _sessions = sessions.lock().map_err(|e| e.to_string())?;
            crate::traffic_store::save(&app, &parse_id)
        })
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(&parse_id)
            .ok_or("Processed log session expired. Upload the log again.")?;
        let dataset = session
            .completed
            .as_ref()
            .ok_or("Wait until processing finishes before saving.")?;
        let path = archive_path(&app, &parse_id)?;
        let pending = session
            .archive_path
            .as_ref()
            .ok_or("This processed log has already been saved.")?;
        let saved = SavedTrafficAnalysis {
            version: ARCHIVE_VERSION,
            saved_at: Utc::now().to_rfc3339(),
            dataset: dataset.clone(),
        };
        let temp = path.with_extension("json.pending");
        let result = (|| -> Result<(), String> {
            let mut writer =
                std::io::BufWriter::new(std::fs::File::create(&temp).map_err(|e| e.to_string())?);
            serde_json::to_writer(&mut writer, &saved).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
            writer.get_ref().sync_all().map_err(|e| e.to_string())?;
            drop(writer);
            session.archive.take();
            let rows = path.with_extension("jsonl");
            std::fs::rename(pending, &rows).map_err(|e| e.to_string())?;
            if let Err(error) = std::fs::rename(&temp, &path) {
                let _ = std::fs::rename(&rows, pending);
                return Err(error.to_string());
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result?;
        session.archive_path = None;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_saved(path: &std::path::Path) -> Result<SavedTrafficAnalysis, String> {
    let reader = std::io::BufReader::new(std::fs::File::open(path).map_err(|e| e.to_string())?);
    let saved: SavedTrafficAnalysis =
        serde_json::from_reader(reader).map_err(|e| format!("Invalid processed log: {e}"))?;
    if saved.version != ARCHIVE_VERSION {
        return Err("This processed log uses an unsupported format version.".into());
    }
    if !path.with_extension("jsonl").is_file() {
        return Err("The processed log record archive is missing.".into());
    }
    Ok(saved)
}

#[tauri::command]
pub async fn load_traffic_analysis(app: AppHandle, id: String) -> Result<AccessLogDataset, String> {
    tokio::task::spawn_blocking(move || {
        if crate::traffic_store::path(&app, &id)?.is_file() {
            return crate::traffic_store::dataset(&app, &id);
        }
        // Older JSONL saves are indexed once, retaining their complete records.
        use std::io::BufRead;
        let legacy = archive_path(&app, &id)?;
        let mut saved = read_saved(&legacy)?.dataset;
        let mut store =
            crate::traffic_store::CaptureStore::create(&app, id.clone(), &saved.source)?;
        let mut records = Vec::new();
        let mut diagnostics = Vec::new();
        for line in std::io::BufReader::new(
            std::fs::File::open(legacy.with_extension("jsonl")).map_err(|e| e.to_string())?,
        )
        .lines()
        {
            let json: serde_json::Value = serde_json::from_str(&line.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if let Some(diagnostic) = json.get("diagnostic") {
                diagnostics
                    .push(serde_json::from_value(diagnostic.clone()).map_err(|e| e.to_string())?);
            } else {
                records.push(serde_json::from_value(json).map_err(|e| e.to_string())?);
            }
            if records.len() + diagnostics.len() >= 1000 {
                store.ingest(&records, &diagnostics)?;
                records.clear();
                diagnostics.clear();
            }
        }
        store.ingest(&records, &diagnostics)?;
        saved.capture_id = Some(id.clone());
        saved.records.clear();
        saved.diagnostics.clear();
        store.snapshot(&saved)?;
        store.complete()?;
        crate::traffic_store::save(&app, &id)?;
        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_traffic_analyses(app: AppHandle) -> Result<Vec<TrafficArchiveInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let mut entries: Vec<TrafficArchiveInfo> = crate::traffic_store::list(&app)?
            .into_iter()
            .map(|c| TrafficArchiveInfo {
                id: c.id,
                source: c.source,
                records: c.records,
                saved_at: c.saved_at,
                path: c.path,
            })
            .collect();
        for entry in std::fs::read_dir(traffic_archive_dir(&app)?).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if entries.iter().any(|entry| {
                    path.file_stem()
                        .is_some_and(|name| name.to_string_lossy() == entry.id)
                }) {
                    continue;
                }
                if let Ok(saved) = read_saved(&path) {
                    entries.push(TrafficArchiveInfo {
                        id: path
                            .file_stem()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned(),
                        source: saved.dataset.source,
                        records: saved.dataset.records_processed,
                        saved_at: saved.saved_at,
                        path: path.display().to_string(),
                    });
                }
            }
        }
        entries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preliminary_chart_sample_has_four_distinct_minutes_and_hours() {
        let content = include_str!("../fixtures/chart_sample.txt");
        let actual = parse_session_chunk(&mut session(4), content, true).unwrap();
        assert_eq!(
            actual
                .timeline
                .iter()
                .map(|bucket| bucket.requests)
                .collect::<Vec<_>>(),
            vec![1, 2, 4, 1]
        );
        assert_eq!(
            actual
                .timeline
                .iter()
                .map(|bucket| bucket.bytes)
                .collect::<Vec<_>>(),
            vec![100, 400, 4000, 500]
        );
        assert_eq!(actual.records_processed, 8);
        assert_eq!(
            actual.timeline.last().unwrap().epoch - actual.timeline[0].epoch,
            405 * 60000
        );
    }

    #[test]
    fn archive_preserves_all_rows_and_reloads_processed_summary_without_parsing() {
        use std::io::BufRead;
        let path = std::env::temp_dir().join(format!(
            "proxytools-traffic-test-{}-{}.json",
            std::process::id(),
            NEXT_PARSE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let rows = path.with_extension("jsonl");
        let mut parser = session(4);
        parser.archive = Some(std::fs::File::create(&rows).unwrap());
        let content = include_str!("../fixtures/chart_sample.txt").repeat(700);
        let mut result = parse_session_chunk(&mut parser, &content, true).unwrap();
        parser.archive.take();
        result.records = parser.tail.iter().cloned().collect();
        assert_eq!(result.records_processed, 5600);
        assert_eq!(result.records.len(), 5000);
        let archived: Vec<AccessLogRecord> =
            std::io::BufReader::new(std::fs::File::open(&rows).unwrap())
                .lines()
                .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
                .collect();
        assert_eq!(archived.len(), 5600);
        assert!(archived.first().unwrap().id.ends_with(":1"));
        assert_eq!(
            archived.last().unwrap().id,
            result.records.last().unwrap().id
        );
        let expected = serde_json::to_value(&result).unwrap();
        let saved = SavedTrafficAnalysis {
            version: ARCHIVE_VERSION,
            saved_at: Utc::now().to_rfc3339(),
            dataset: result,
        };
        serde_json::to_writer(std::fs::File::create(&path).unwrap(), &saved).unwrap();
        assert_eq!(
            serde_json::to_value(read_saved(&path).unwrap().dataset).unwrap(),
            expected
        );
        std::fs::remove_file(&rows).unwrap();
        assert!(read_saved(&path).unwrap_err().contains("missing"));
        std::fs::remove_file(&path).unwrap();
    }

    fn session(workers: usize) -> ParseSession {
        let mut session = ParseSession::default();
        session.source = "anonymous-fixture".to_string();
        session.workers = workers;
        session
    }

    #[test]
    fn parallel_rows_match_serial_rows_across_schema_changes_and_malformed_lines() {
        let content = MOCK_ACCESS_LOG.repeat(20);
        let expected = make_dataset("anonymous-fixture", &content);
        let serial = parse_session_chunk(&mut session(1), &content, true).unwrap();
        let parallel = parse_session_chunk(&mut session(4), &content, true).unwrap();
        assert!(parallel.records_processed > 256);
        assert_eq!(
            serde_json::to_value(&expected).unwrap(),
            serde_json::to_value(&serial).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&serial).unwrap(),
            serde_json::to_value(&parallel).unwrap()
        );
    }

    #[test]
    fn incremental_parser_preserves_split_headers_quoted_values_and_final_line() {
        let content = "before-header\r\n#Fields: date time cs-host sc-bytes cs(User-Agent)\r\n2026-10-08 03:00:00 host.example 123 \"quoted agent\"\r\n#Fields: sc-bytes cs-host date time\r\n999 other.example 2026-10-08 03:01:00";
        let expected = make_dataset("anonymous-fixture", content);
        let mut parser = session(4);
        let mut records = Vec::new();
        let mut diagnostics = Vec::new();
        let mut final_result = None;
        let chunks: Vec<_> = content.as_bytes().chunks(13).collect();
        for (index, chunk) in chunks.iter().enumerate() {
            let mut result = parse_session_chunk(
                &mut parser,
                std::str::from_utf8(chunk).unwrap(),
                index == chunks.len() - 1,
            )
            .unwrap();
            records.append(&mut result.records);
            diagnostics.append(&mut result.diagnostics);
            final_result = Some(result);
        }
        let mut actual = final_result.unwrap();
        actual.records = records;
        actual.diagnostics = diagnostics;
        assert!(parser.carry.is_empty());
        assert_eq!(
            serde_json::to_value(&expected).unwrap(),
            serde_json::to_value(&actual).unwrap()
        );
    }

    #[test]
    fn ipc_retention_keeps_full_totals_and_latest_records_in_order() {
        let content = MOCK_ACCESS_LOG.repeat(150);
        let expected = make_dataset("anonymous-fixture", &content);
        let actual = parse_session_chunk(&mut session(4), &content, true).unwrap();
        assert!(expected.records.len() > 5000);
        assert_eq!(actual.records.len(), 5000);
        assert_eq!(actual.records_processed, expected.records_processed);
        assert_eq!(actual.bytes_processed, expected.bytes_processed);
        assert_eq!(actual.diagnostics_total, expected.diagnostics_total);
        assert_eq!(
            serde_json::to_value(&actual.field_availability).unwrap(),
            serde_json::to_value(&expected.field_availability).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&actual.records).unwrap(),
            serde_json::to_value(&expected.records[expected.records.len() - 5000..]).unwrap()
        );
    }

    #[test]
    #[ignore = "Manual timing check; results depend on machine load and build profile."]
    fn benchmark_access_log_workers() {
        let content = MOCK_ACCESS_LOG.repeat(500);
        let workers = get_traffic_processing_config().recommended_workers;
        let started = std::time::Instant::now();
        let serial = parse_session_chunk(&mut session(1), &content, true).unwrap();
        let serial_time = started.elapsed();
        let started = std::time::Instant::now();
        let parallel = parse_session_chunk(&mut session(workers), &content, true).unwrap();
        let parallel_time = started.elapsed();
        assert_eq!(
            serde_json::to_value(&serial).unwrap(),
            serde_json::to_value(&parallel).unwrap()
        );
        eprintln!(
            "traffic benchmark: raw_bytes={} rows={} workers={} serial_ms={} parallel_ms={}",
            content.len(),
            parallel.records_processed,
            workers,
            serial_time.as_millis(),
            parallel_time.as_millis()
        );
    }
}
