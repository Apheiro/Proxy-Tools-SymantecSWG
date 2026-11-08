//! Read-only Active Connections monitor. Separate storage and worker from access logs.
mod mock;
mod parser;
mod store;

use parser::{hash, Parsed};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use store::Snapshot;
use tauri::{Manager, State};
use tokio::{sync::Notify, task::JoinHandle};
use tokio_util::sync::CancellationToken;

const ROUTES: [&str; 2] = ["/AS/ProxiedConnections/XML", "/AS/Sessions/xml"];
#[derive(Default)]
pub struct ActiveConnectionsState {
    workers: tokio::sync::Mutex<HashMap<String, Worker>>,
    queries: Arc<Mutex<HashMap<String, rusqlite::InterruptHandle>>>,
}
struct Worker {
    run: Arc<Run>,
    task: JoinHandle<()>,
}
struct Run {
    id: String,
    scope: String,
    profile: String,
    proxy: String,
    path: PathBuf,
    // Zero selects sequential continuous polling, never a zero-duration timer.
    interval: u64,
    stop: CancellationToken,
    poll: Mutex<CancellationToken>,
    paused: AtomicBool,
    refresh: AtomicBool,
    pause_pending: AtomicBool,
    wake: Notify,
    status: Mutex<Status>,
    credentials: Mutex<(String, String)>,
}
#[derive(Clone, Serialize, Default)]
pub struct Status {
    id: String,
    state: String,
    interval: u64,
    route: String,
    last: Option<Snapshot>,
    last_good: Option<Snapshot>,
    error: Option<String>,
    polls: u64,
    failures: u32,
}
#[derive(Deserialize)]
pub struct Scope {
    pub proxy: String,
    pub profile: String,
}
impl Scope {
    fn key(&self) -> Result<String, String> {
        if !matches!(self.profile.as_str(), "live" | "mock") {
            return Err("Invalid data profile".into());
        }
        let base = crate::proxy_base_url(&self.proxy)?;
        Ok(hash(&format!(
            "{}:{}",
            self.profile,
            base.origin().ascii_serialization()
        )))
    }
}
fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Application cache unavailable")?
        .join("active-connections");
    std::fs::create_dir_all(&dir).map_err(|_| "Could not create Active Connections cache")?;
    Ok(dir)
}
fn capture_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid capture ID".into());
    }
    Ok(directory(app)?.join(format!("{id}.sqlite")))
}
async fn end(worker: Worker) {
    worker.run.stop.cancel();
    worker.run.poll.lock().unwrap().cancel();
    worker.run.wake.notify_one();
    let _ = worker.task.await;
}
/// Profile switches stop incompatible work; navigation never owns a worker.
#[tauri::command]
pub async fn ac_guard(
    state: State<'_, ActiveConnectionsState>,
    profile: String,
) -> Result<(), String> {
    if !matches!(profile.as_str(), "live" | "mock") {
        return Err("Invalid profile".into());
    }
    let mut workers = state.workers.lock().await;
    let incompatible: Vec<String> = workers.iter()
        .filter(|(_, w)| w.run.profile != profile)
        .map(|(key, _)| key.clone()).collect();
    for key in incompatible {
        if let Some(old) = workers.remove(&key) { end(old).await; }
    }
    Ok(())
}
#[tauri::command]
pub async fn ac_attach(
    state: State<'_, ActiveConnectionsState>,
    scope: Scope,
) -> Result<Option<Status>, String> {
    ac_status(state, scope).await
}
#[derive(Serialize)]
pub struct RunningTask {
    proxy: String,
    status: String,
    interval: u64,
}
/// Sanitized inventory: no credentials, XML, or cross-profile results.
#[tauri::command]
pub async fn ac_list_running(
    state: State<'_, ActiveConnectionsState>,
    profile: String,
) -> Result<Vec<RunningTask>, String> {
    if !matches!(profile.as_str(), "live" | "mock") {
        return Err("Invalid profile".into());
    }
    let workers = state.workers.lock().await;
    Ok(workers.values().filter_map(|w| {
        let status = w.run.status.lock().unwrap();
        (w.run.profile == profile && !w.task.is_finished()
            && !w.run.stop.is_cancelled() && !w.run.paused.load(Ordering::SeqCst)
            && matches!(status.state.as_str(), "Running" | "Backoff"))
            .then(|| RunningTask { proxy: w.run.proxy.clone(), status: status.state.clone(), interval: w.run.interval })
    }).collect())
}
#[tauri::command]
pub async fn ac_start(
    app: tauri::AppHandle,
    state: State<'_, ActiveConnectionsState>,
    scope: Scope,
    username: String,
    password: String,
    interval: u64,
) -> Result<Status, String> {
    let key = scope.key()?;
    if !matches!(interval, 0 | 5 | 10 | 30 | 60) {
        return Err("Choose Continuous, 5, 10, 30 or 60 seconds".into());
    }
    let base = crate::proxy_base_url(&scope.proxy)?;
    let mut workers = state.workers.lock().await;
    if let Some(old) = workers.remove(&key) {
        end(old).await;
    }
    let id = hash(&format!(
        "{key}:{}:{:?}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        Instant::now()
    ));
    let path = capture_path(&app, &id)?;
    let p = path.clone();
    let k = key.clone();
    tokio::task::spawn_blocking(move || {
        store::create(&p, &k, interval, chrono::Utc::now().timestamp_millis())
    })
    .await
    .map_err(|_| "Capture creation interrupted")??;
    let status = Status {
        id: id.clone(),
        state: "Running".into(),
        interval,
        route: ROUTES[0].into(),
        ..Default::default()
    };
    let run = Arc::new(Run {
        id,
        scope: key.clone(),
        profile: scope.profile.clone(),
        proxy: scope.proxy.clone(),
        path,
        interval,
        stop: CancellationToken::new(),
        poll: Mutex::new(CancellationToken::new()),
        paused: AtomicBool::new(false),
        refresh: AtomicBool::new(false),
        pause_pending: AtomicBool::new(false),
        wake: Notify::new(),
        status: Mutex::new(status.clone()),
        credentials: Mutex::new(if scope.profile == "mock" {
            (String::new(), String::new())
        } else {
            (username, password)
        }),
    });
    let r = run.clone();
    let mocked = scope.profile == "mock";
    // No credentials are captured by the mock worker or written to SQLite.
    let task = tokio::spawn(async move {
        poll_loop(r, base, mocked).await;
    });
    workers.insert(key, Worker { run, task });
    Ok(status)
}
#[tauri::command]
pub async fn ac_control(
    state: State<'_, ActiveConnectionsState>,
    scope: Scope,
    id: String,
    action: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<Status, String> {
    let key = scope.key()?;
    let workers = state.workers.lock().await;
    let run = &workers
        .get(&key)
        .filter(|w| w.run.id == id)
        .ok_or("No matching running capture")?
        .run;
    if run.stop.is_cancelled() && action != "stop" {
        return Err("Capture has stopped; start a new capture".into());
    }
    match action.as_str() {
        "pause" => {
            run.pause_pending.store(true, Ordering::SeqCst);
            run.paused.store(true, Ordering::SeqCst);
            run.poll.lock().unwrap().cancel();
            run.status.lock().unwrap().state = "Paused".into();
            run.wake.notify_one();
        }
        "resume" => {
            if run.stop.is_cancelled() {
                return Err("Start a new capture after Stop".into());
            }
            if run.profile == "live" {
                if let (Some(user), Some(pass)) = (username, password) {
                    *run.credentials.lock().unwrap() = (user, pass);
                }
            }
            run.paused.store(false, Ordering::SeqCst);
            run.status.lock().unwrap().state = "Running".into();
            run.wake.notify_one();
        }
        "refresh" => {
            if run.stop.is_cancelled() {
                return Err("Capture has stopped".into());
            }
            run.refresh.store(true, Ordering::SeqCst);
            run.wake.notify_one();
        }
        "stop" => {
            run.stop.cancel();
            run.poll.lock().unwrap().cancel();
            run.status.lock().unwrap().state = "Stopping".into();
            run.wake.notify_one();
        }
        _ => return Err("Invalid capture action".into()),
    }
    let status = run.status.lock().unwrap().clone();
    Ok(status)
}
#[tauri::command]
pub async fn ac_status(
    state: State<'_, ActiveConnectionsState>,
    scope: Scope,
) -> Result<Option<Status>, String> {
    let key = scope.key()?;
    let workers = state.workers.lock().await;
    Ok(workers
        .get(&key)
        .map(|w| w.run.status.lock().unwrap().clone()))
}
#[tauri::command]
pub async fn ac_save(app: tauri::AppHandle, scope: Scope, id: String) -> Result<(), String> {
    let key = scope.key()?;
    let path = capture_path(&app, &id)?;
    tokio::task::spawn_blocking(move || store::save(&path, &key))
        .await
        .map_err(|_| "Save interrupted")?
}
#[tauri::command]
pub async fn ac_list(app: tauri::AppHandle, scope: Scope) -> Result<Vec<Value>, String> {
    let key = scope.key()?;
    let dir = directory(&app)?;
    tokio::task::spawn_blocking(move || {
        let mut items = Vec::new();
        for entry in std::fs::read_dir(dir)
            .map_err(|_| "Capture library unavailable")?
            .flatten()
        {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("sqlite") {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            // Scope mismatch is deliberately excluded; never expose other profiles.
            if let Ok(Some(item)) = store::archive(&path, &key, id) {
                items.push(item);
            }
        }
        items.sort_by_key(|v| std::cmp::Reverse(v["started"].as_i64().unwrap_or_default()));
        Ok(items)
    })
    .await
    .map_err(|_| "Library query interrupted")?
}
#[tauri::command]
pub async fn ac_query(
    app: tauri::AppHandle,
    state: State<'_, ActiveConnectionsState>,
    scope: Scope,
    id: String,
    request_id: String,
    query: store::Query,
) -> Result<Value, String> {
    let key = scope.key()?;
    let path = capture_path(&app, &id)?;
    if request_id.len() > 128 {
        return Err("Invalid query identifier".into());
    }
    let queries = state.queries.clone();
    tokio::task::spawn_blocking(move || {
        let conn = store::open(&path, &key, true)?;
        {
            let mut registry = queries.lock().map_err(|_| "Query registry unavailable")?;
            if registry.contains_key(&request_id) {
                return Err("Duplicate query identifier".into());
            }
            registry.insert(request_id.clone(), conn.get_interrupt_handle());
        }
        let result = store::query(&conn, query);
        if let Ok(mut registry) = queries.lock() {
            registry.remove(&request_id);
        }
        result
    })
    .await
    .map_err(|_| "Capture query interrupted")?
}
#[tauri::command]
pub fn ac_cancel_query(state: State<'_, ActiveConnectionsState>, request_id: String) {
    if let Ok(registry) = state.queries.lock() {
        if let Some(handle) = registry.get(&request_id) {
            handle.interrupt();
        }
    }
}

struct Failure {
    message: String,
    fallback: bool,
    auth: bool,
    bytes: usize,
}
impl Failure {
    fn new(message: &str, fallback: bool) -> Self {
        Self {
            message: message.into(),
            fallback,
            auth: false,
            bytes: 0,
        }
    }
    fn auth(message: &str) -> Self {
        Self {
            message: message.into(),
            fallback: false,
            auth: true,
            bytes: 0,
        }
    }
}
async fn fetch_document(
    base: &reqwest::Url,
    route: usize,
    user: &str,
    pass: &str,
) -> Result<(String, usize), Failure> {
    let url = base
        .join(ROUTES[route])
        .map_err(|_| Failure::new("Invalid fixed management route", false))?;
    let client=crate::proxy_transport::authenticated_client_for(&url,user,pass,false).await.map_err(|_|Failure::auth("Management authentication could not be confirmed. Check credentials and retry explicitly."))?;
    let mut response = client
        .get(url.clone())
        .timeout(Duration::from_secs(25))
        .send()
        .await
        .map_err(|_| Failure::new("Management route unavailable or timed out", true))?;
    let status = response.status().as_u16();
    if matches!(status, 401 | 403) {
        crate::proxy_transport::invalidate(&url, user, pass, false);
        return Err(Failure::auth(
            "Authentication error (HTTP 401/403). Update credentials and Resume explicitly.",
        ));
    }
    if !response.status().is_success() {
        return Err(Failure::new(
            &format!("Management HTTP {status}"),
            matches!(status, 404 | 405 | 410 | 501),
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > 16 * 1024 * 1024)
    {
        return Err(Failure::new("Response exceeds 16 MiB limit", false));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Failure::new("Response body interrupted", true))?
    {
        if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
            return Err(Failure::new("Response exceeds 16 MiB limit", false));
        }
        bytes.extend_from_slice(&chunk);
    }
    let len = bytes.len();
    let xml =
        String::from_utf8(bytes).map_err(|_| Failure::new("Response is not UTF-8 XML", true))?;
    crate::proxy_transport::check_document(&xml,&url,user,pass,false).map_err(|_|Failure::auth("Authentication error: management returned a login form instead of XML. Resume explicitly after checking credentials."))?;
    Ok((xml, len))
}
async fn fetch(
    base: &reqwest::Url,
    route: usize,
    user: &str,
    pass: &str,
    cancellation: &CancellationToken,
) -> Result<(Parsed, String, usize), Failure> {
    let (xml, len) = tokio::select! {
        _ = cancellation.cancelled() => return Err(Failure::new("Poll cancelled", false)),
        result = tokio::time::timeout(Duration::from_secs(30), fetch_document(base, route, user, pass)) =>
            result.map_err(|_| Failure::new("Poll timed out; missing sample", true))??,
    };
    // Always join an already-started parse before another fetch can begin.
    // Cancellation discards its result below instead of detaching CPU work.
    // Parsing is CPU work outside Tokio's executor. Raw XML never crosses IPC.
    tokio::task::spawn_blocking(move || {
        let digest = hash(&xml);
        parser::parse(&xml)
            .map(|p| (p, digest, len))
            .map_err(|e| Failure {
                message: e,
                fallback: true,
                auth: false,
                bytes: len,
            })
    })
    .await
    .map_err(|_| Failure::new("XML parsing interrupted", false))?
}
async fn poll_loop(run: Arc<Run>, base: reqwest::Url, mocked: bool) {
    let mut route = 0usize;
    let mut tick = 0u64;
    let mut failures = 0u32;
    let mut first = true;
    loop {
        if run.stop.is_cancelled() {
            break;
        }
        if first {
            first = false;
        } else {
            let delay = if run.paused.load(Ordering::SeqCst) {
                Duration::from_secs(86400)
            } else {
                if failures == 0 && run.interval == 0 {
                    Duration::from_millis(350)
                } else {
                    Duration::from_secs((run.interval.max(1) * 2u64.pow(failures.min(4))).min(120))
                }
            };
            tokio::select! { _=run.stop.cancelled()=>break, _=run.wake.notified()=>{}, _=tokio::time::sleep(delay)=>{} }
        }
        if run.pause_pending.swap(false, Ordering::SeqCst) {
            let path = run.path.clone();
            let scope = run.scope.clone();
            let marker = Snapshot {
                received_at: chrono::Utc::now().timestamp_millis(),
                endpoint: ROUTES[route].into(),
                quality: "Paused".into(),
                warnings: vec![
                    "Sampling paused intentionally; concurrency is unknown in this interval".into(),
                ],
                ..Default::default()
            };
            let stored =
                tokio::task::spawn_blocking(move || store::append(&path, &scope, marker, None))
                    .await;
            match stored {
                Ok(Ok(marker)) => {
                    run.status.lock().unwrap().last = Some(marker);
                }
                _ => {
                    run.status.lock().unwrap().error =
                        Some("Could not record pause annotation".into());
                }
            }
        }
        let refresh = run.refresh.swap(false, Ordering::SeqCst);
        if run.paused.load(Ordering::SeqCst) && !refresh {
            continue;
        }
        let cancellation = run.stop.child_token();
        {
            let mut active_poll = run.poll.lock().unwrap();
            *active_poll = cancellation.clone();
            // Pause sets its flag before taking this same lock to cancel.
            // Recheck here so it cannot accidentally cancel only the previous token.
            if run.paused.load(Ordering::SeqCst) && !refresh {
                cancellation.cancel();
            }
        }
        if run.stop.is_cancelled() {
            break;
        }
        let (user, pass) = run.credentials.lock().unwrap().clone();
        let started = Instant::now();
        let result = async {
                if mocked {
                    if tick % 12 == 6 { return Err(Failure::new("Synthetic missing poll: fixture gap (no zero concurrency inferred)",false)); }
                    let xml=if tick % 20 == 10 {mock::empty()}else{mock::xml(tick)}; let len=xml.len(); let digest=hash(&xml);
                    return parser::parse(&xml).map(|p|(p,digest,len)).map_err(|e|Failure::new(&e,false));
                }
                match fetch(&base,route,&user,&pass,&cancellation).await {
                    Ok(value)=>Ok(value),
                    Err(first) if first.fallback=>{
                        let alternate=1-route;
                        match fetch(&base,alternate,&user,&pass,&cancellation).await {
                            Ok((p,digest,len))=>{route=alternate;Ok((p,digest,len+first.bytes))},
                            Err(second)=>Err(Failure{message:format!("Both XML routes failed. {}",second.message),..second})
                        }
                    }
                    Err(error)=>Err(error)
                }
        }.await;
        if run.stop.is_cancelled() { break; }
        if cancellation.is_cancelled() { continue; }
        tick += 1;
        let mut sample = Snapshot {
            received_at: chrono::Utc::now().timestamp_millis(),
            endpoint: ROUTES[route].into(),
            duration_ms: started.elapsed().as_millis() as i64,
            ..Default::default()
        };
        if route == 1 {
            sample.warnings.push("Alternate XML route selected after primary route failure; schema verified, route equivalence not assumed".into());
        }
        let parsed = match result {
            Ok((p, digest, len)) => {
                sample.content_hash = Some(digest);
                sample.response_bytes = len as i64;
                failures = 0;
                Some(p)
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                sample.quality = if error.auth { "Auth error" } else { "Gap" }.into();
                sample.response_bytes = error.bytes as i64;
                sample.warnings.push(error.message);
                if error.auth {
                    run.paused.store(true, Ordering::SeqCst);
                }
                None
            }
        };
        let path = run.path.clone();
        let scope = run.scope.clone();
        let stored =
            tokio::task::spawn_blocking(move || store::append(&path, &scope, sample, parsed)).await;
        let mut status = run.status.lock().unwrap();
        status.polls += 1;
        status.failures = failures;
        status.route = ROUTES[route].into();
        match stored {
            Ok(Ok(sample)) => {
                if matches!(sample.quality.as_str(), "OK" | "Empty") {
                    status.last_good = Some(sample.clone());
                    status.error = None;
                } else {
                    status.error = Some(sample.warnings.join("; "));
                }
                status.last = Some(sample);
            }
            _ => {
                status.error=Some("Capture write failed; monitoring paused. Save/reopen or start another capture.".into());
                run.paused.store(true, Ordering::SeqCst);
            }
        }
        status.state = if run.paused.load(Ordering::SeqCst) {
            "Paused"
        } else if failures > 0 {
            "Backoff"
        } else {
            "Running"
        }
        .into();
        if refresh && run.paused.load(Ordering::SeqCst) && failures == 0 {
            run.pause_pending.store(true, Ordering::SeqCst);
            run.wake.notify_one();
        }
    }
    let path = run.path.clone();
    let scope = run.scope.clone();
    let _ = tokio::task::spawn_blocking(move || store::finish(&path, &scope)).await;
    *run.credentials.lock().unwrap() = (String::new(), String::new());
    run.status.lock().unwrap().state = "Stopped".into();
}
