use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use regex::Regex;
use reqwest::{Client, Response, Url};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::traffic_analysis::{
    complete_capture_session, create_capture_session, parse_session_chunk, AccessLogDataset,
    AccessLogParseState, ParseSession,
};

const LOG_PREFIX: &str = "/Accesslog/tail-f/";

#[derive(Default)]
pub struct TrafficStreamState(Arc<Mutex<HashMap<String, (CancellationToken, CancellationToken)>>>);

#[derive(Clone, Debug, Serialize)]
pub struct AccessLogSource {
    name: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamStatus {
    stream_id: String,
    capture_id: String,
    status: String,
    url: String,
    message: String,
}

fn base_url(proxy_ip: &str, use_mock_data: bool) -> Result<Url, String> {
    if use_mock_data {
        Url::parse("http://127.0.0.1:5500/").map_err(|e| e.to_string())
    } else {
        crate::proxy_base_url(proxy_ip)
    }
}

fn index_url(base: &Url, use_mock_data: bool) -> Result<Url, String> {
    base.join(if use_mock_data {
        "Accesslog/tail-f.html"
    } else {
        "Accesslog/tail-f"
    })
    .map_err(|e| e.to_string())
}

fn source_url(base: &Url, name: &str, use_mock_data: bool) -> Result<Url, String> {
    if name.is_empty()
        || name.len() > 256
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | '?' | '#' | '%'))
    {
        return Err("Invalid access log name. Select a log from the available index.".into());
    }
    let mut url = base.clone();
    let filename = if use_mock_data {
        format!("{name}.html")
    } else {
        name.to_owned()
    };
    url.path_segments_mut()
        .map_err(|_| "Invalid access log base URL.")?
        .clear()
        .extend(["Accesslog", "tail-f", &filename]);
    Ok(url)
}

fn parse_log_index(
    html: &str,
    base: &Url,
    document_url: &Url,
    use_mock_data: bool,
) -> Vec<AccessLogSource> {
    let links = Regex::new(r#"(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>"#)
        .expect("static link pattern");
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for link in links.captures_iter(html) {
        let href = html_escape::decode_html_entities(&link[1]);
        let Ok(url) = document_url.join(&href) else {
            continue;
        };
        if url.origin() != base.origin()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            continue;
        }
        let Some(name) = url.path().strip_prefix(LOG_PREFIX) else {
            continue;
        };
        // The mock index mirrors real links; mock files may also link with .html.
        let name = if use_mock_data && name.to_ascii_lowercase().ends_with(".html") {
            &name[..name.len() - 5]
        } else {
            name
        };
        if let Ok(url) = source_url(base, name, use_mock_data) {
            if seen.insert(name.to_owned()) {
                sources.push(AccessLogSource {
                    name: name.to_owned(),
                    url: url.to_string(),
                });
            }
        }
    }
    sources
}

async fn send_request(
    client: &Client,
    url: &Url,
    username: &str,
    password: &str,
    use_mock_data: bool,
) -> Result<Response, String> {
    let request = client.get(url.clone());

    // This deadline covers receiving the HTTP headers only, never the stream body.
    let response = tokio::time::timeout(Duration::from_secs(30), request.send())
        .await
        .map_err(|_| format!("Timed out waiting for access log response headers from {url}."))?
        .map_err(|error| {
            crate::describe_request_error("connecting to the access log", url, error)
        })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED { crate::proxy_transport::invalidate(url, username, password, use_mock_data); }
    response
        .error_for_status()
        .map_err(|error| crate::describe_request_error("fetching access log data", url, error))
}

#[tauri::command]
pub async fn get_traffic_access_logs(
    proxy_ip: String,
    username: String,
    password: String,
    use_mock_data: bool,
) -> Result<Vec<AccessLogSource>, String> {
    if !use_mock_data && (username.is_empty() || password.is_empty()) {
        return Err(
            "Proxy credentials are required. Configure a username and password in Settings.".into(),
        );
    }
    let base = base_url(&proxy_ip, use_mock_data)?;
    let url = index_url(&base, use_mock_data)?;
    let client = crate::proxy_transport::client_for(&url, &username, &password, use_mock_data)?;
    let mut response = send_request(&client, &url, &username, &password, use_mock_data).await?;
    let document_url = response.url().clone();
    // Only the index is finite. Bound it and ignore live-server scripts/footer.
    let html =
        tokio::time::timeout(Duration::from_secs(30), async {
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|e| {
                crate::describe_request_error("reading the access log index", &url, e)
            })? {
                if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                    return Err("The access log index exceeds 2 MiB.".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok::<_, String>(String::from_utf8_lossy(&bytes).into_owned())
        })
        .await
        .map_err(|_| "Timed out reading the access log index.".to_string())??;
    let logs = parse_log_index(&html, &base, &document_url, use_mock_data);
    if logs.is_empty() {
        return Err(format!("No access log links were found in {url}."));
    }
    Ok(logs)
}

// Transport decoding is separate from ELFF parsing. Preserve UTF-8, entity, tag,
// schema and record boundaries even when a network packet splits any of them.
#[derive(Default)]
struct StreamingLogText {
    bytes: Vec<u8>,
    html: Option<bool>,
    in_pre: bool,
    in_tag: bool,
    tag: String,
    quote: Option<char>,
    line: String,
}

impl StreamingLogText {
    fn push(&mut self, bytes: &[u8], final_chunk: bool) -> Result<String, String> {
        self.bytes.extend_from_slice(bytes);
        let text = match std::str::from_utf8(&self.bytes) {
            Ok(text) => {
                let text = text.to_owned();
                self.bytes.clear();
                text
            }
            Err(error) if error.error_len().is_none() && !final_chunk => {
                let valid = error.valid_up_to();
                let text = std::str::from_utf8(&self.bytes[..valid])
                    .map_err(|e| e.to_string())?
                    .to_owned();
                self.bytes.drain(..valid);
                text
            }
            Err(_) => return Err("The access log response contains invalid UTF-8 text.".into()),
        };
        let mut output = String::new();
        for character in text.chars() {
            if self.html.is_none() {
                if character.is_whitespace() || character == '\u{feff}' {
                    continue;
                }
                self.html = Some(character == '<');
            }
            if self.html == Some(false) {
                self.add_text(character, &mut output)?;
                continue;
            }
            if self.in_tag {
                if let Some(quote) = self.quote {
                    if character == quote {
                        self.quote = None;
                    }
                } else if character == '\'' || character == '"' {
                    self.quote = Some(character);
                } else if character == '>' {
                    let tag = self.tag.trim().to_ascii_lowercase();
                    let name = tag.split_whitespace().next().unwrap_or("");
                    match name {
                        "pre" => self.in_pre = true,
                        "/pre" => {
                            self.flush_line(&mut output);
                            self.in_pre = false;
                        }
                        "br" | "br/" if self.in_pre => self.flush_line(&mut output),
                        _ => {}
                    }
                    self.in_tag = false;
                    self.tag.clear();
                    continue;
                }
                self.tag.push(character);
                if self.tag.len() > 65536 {
                    return Err("The access log HTML contains an oversized tag.".into());
                }
            } else if character == '<' {
                self.in_tag = true;
            } else if self.in_pre {
                self.add_text(character, &mut output)?;
            }
        }
        if final_chunk {
            self.flush_line(&mut output);
        }
        Ok(output)
    }

    fn add_text(&mut self, character: char, output: &mut String) -> Result<(), String> {
        if character == '\n' {
            self.flush_line(output);
        } else {
            self.line.push(character);
            if self.line.len() > 1024 * 1024 {
                return Err("An access log line exceeds the 1 MiB safety limit.".into());
            }
        }
        Ok(())
    }

    fn flush_line(&mut self, output: &mut String) {
        if self.line.is_empty() {
            return;
        }
        let line = if self.html == Some(true) {
            html_escape::decode_html_entities(&self.line).into_owned()
        } else {
            self.line.clone()
        };
        let trim = line.trim();
        if !trim.is_empty()
            && trim != "Access Log Tail"
            && !trim.starts_with("The current time is ")
        {
            output.push_str(&line);
            output.push('\n');
        }
        self.line.clear();
    }
}

fn merge_pending(current: &mut Option<AccessLogDataset>, next: AccessLogDataset) {
    // Counters are cumulative; full records already reside in the capture database.
    *current = Some(next);
}

type CaptureSessions = Arc<Mutex<HashMap<String, ParseSession>>>;
async fn parse_received(
    sessions: CaptureSessions,
    id: String,
    text: String,
    final_chunk: bool,
) -> Result<AccessLogDataset, String> {
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions
            .lock()
            .map_err(|_| "Capture state is unavailable.")?;
        let session = sessions
            .get_mut(&id)
            .ok_or("Capture session has expired.")?;
        parse_session_chunk(session, &text, final_chunk)
    })
    .await
    .map_err(|e| e.to_string())?
}
async fn finish_received(
    sessions: CaptureSessions,
    id: String,
) -> Result<AccessLogDataset, String> {
    tokio::task::spawn_blocking(move || {
        let mut sessions = sessions
            .lock()
            .map_err(|_| "Capture state is unavailable.")?;
        complete_capture_session(
            sessions
                .get_mut(&id)
                .ok_or("Capture session has expired.")?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
async fn read_traffic_response(
    mut response: Response,
    token: &CancellationToken,
    sessions: CaptureSessions,
    id: String,
    mut publish: impl FnMut(AccessLogDataset),
) -> Result<(), String> {
    let url = response.url().clone();
    let mut text = StreamingLogText::default();
    let mut pending = None;
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _=token.cancelled()=>{if let Some(dataset)=pending.take(){publish(dataset);}return Ok(());},
            _=interval.tick()=>if let Some(dataset)=pending.take(){publish(dataset);},
            chunk=response.chunk()=>{
                let chunk=chunk.map_err(|e|crate::describe_request_error("reading the access log stream",&url,e))?;
                let finished=chunk.is_none();let decoded=text.push(chunk.as_deref().unwrap_or_default(),finished)?;
                if !decoded.is_empty()||finished {
                    let dataset=parse_received(Arc::clone(&sessions),id.clone(),decoded,finished).await?;
                    merge_pending(&mut pending,dataset);
                }
                if finished {if let Some(dataset)=pending.take(){if dataset.fields.is_empty(){return Err("The response contains no #Fields schema.".into());}publish(dataset);}return Ok(());}
            }
        }
    }
}

#[tauri::command]
pub async fn start_traffic_stream(
    app: AppHandle,
    stream_id: String,
    proxy_ip: String,
    log_name: String,
    username: String,
    password: String,
    use_mock_data: bool,
    state: State<'_, TrafficStreamState>,
    parse_state: State<'_, AccessLogParseState>,
) -> Result<String, String> {
    if !use_mock_data && (username.is_empty() || password.is_empty()) {
        return Err(
            "Proxy credentials are required. Configure a username and password in Settings.".into(),
        );
    }
    let url = source_url(
        &base_url(&proxy_ip, use_mock_data)?,
        &log_name,
        use_mock_data,
    )?;
    let client = crate::proxy_transport::client_for(&url, &username, &password, use_mock_data)?;
    let token = CancellationToken::new();
    let streams = Arc::clone(&state.0);
    let (capture_id, session) = create_capture_session(&app, url.to_string(), None)?;
    let sessions = Arc::clone(&parse_state.0);
    sessions
        .lock()
        .map_err(|_| "Capture state is unavailable.")?
        .insert(capture_id.clone(), session);
    let returned_id = capture_id.clone();
    let done = CancellationToken::new();
    if let Some(previous) = streams
        .lock()
        .map_err(|_| "Traffic stream state is unavailable.")?
        .insert(stream_id.clone(), (token.clone(), done.clone()))
    {
        previous.0.cancel();
    }
    tauri::async_runtime::spawn(async move {
        let status = |status: &str, message: &str| {
            let _ = app.emit(
                "traffic-analysis:status",
                StreamStatus {
                    stream_id: stream_id.clone(),
                    capture_id: capture_id.clone(),
                    status: status.to_owned(),
                    url: url.to_string(),
                    message: message.to_owned(),
                },
            );
        };
        status("connecting", "Connecting to the selected access log.");
        let result = async {
            let response = tokio::select! { _ = token.cancelled() => return Ok(()), response = send_request(&client, &url, &username, &password, use_mock_data) => response? };
            status("streaming", "Receiving access log data.");
            read_traffic_response(response, &token, Arc::clone(&sessions), capture_id.clone(), |dataset| { let _ = app.emit("traffic-analysis:update", (&stream_id, dataset)); }).await
        }.await;
        let finished = finish_received(sessions, capture_id.clone()).await;
        if let Ok(dataset) = finished.as_ref() {
            let _ = app.emit("traffic-analysis:update", (&stream_id, dataset));
        }
        let result = result.and(finished.map(|_| ()));
        if token.is_cancelled() && result.is_ok() {
            status("paused", "The stream was stopped.");
        } else if let Err(error) = result {
            status("error", &error);
        } else {
            status(
                "completed",
                if use_mock_data {
                    "Mock response finished. The snapshot remains available for analysis."
                } else {
                    "The server closed the stream. Received records remain available for analysis."
                },
            );
        }
        done.cancel();
        if let Ok(mut streams) = streams.lock() {
            streams.remove(&stream_id);
        }
    });
    Ok(returned_id)
}

#[tauri::command]
pub async fn stop_traffic_stream(
    stream_id: String,
    state: State<'_, TrafficStreamState>,
) -> Result<(), String> {
    let tokens = state
        .0
        .lock()
        .map_err(|_| "Traffic stream state is unavailable.")?
        .get(&stream_id)
        .cloned();
    if let Some((token, done)) = tokens {
        token.cancel();
        done.cancelled().await;
    }
    Ok(())
}
