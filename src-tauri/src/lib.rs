

        // // === CONFIG - igual que vos, cambiá lo que necesites ===
        // let url: &str  = "https://10.190.2.27:8082/Policy/Trace/TraceJaen";
        // let user: &str = user_p;
        // let pass: &str = pass_p;
        // // let raw_out: &str  = r"C:\Users\ETUYON\Desktop\trace logs\rawLogs.log";
        // // let json_out: &str  = r"C:\Users\ETUYON\Desktop\trace logs\logs.jsonl";
        // let interval_secs: u64 = 5;

        // // === Cliente HTTP (con jar, UA y certs inseguros) ===
        // let jar = Arc::new(CookieStoreMutex::new(CookieStore::default()));
        // let client = reqwest::Client::builder()
        //     .cookie_provider(jar)
        //     .user_agent("trace-tools/0.1")
        //     .danger_accept_invalid_certs(true) // SOLO pruebas
        //     .build().expect("Error building client");
    
        // let cache_dir = check_cache_dir(&app).expect("Error getting cache dir");
        // let mut raw_logs = OpenOptions::new().create(true).append(true).open(cache_dir.join("rawLogs.log")).expect("Error opening rawLogs.log");
        // let mut json_logs = OpenOptions::new().create(true).append(true).open(cache_dir.join("logs.jsonl")).expect("Error opening logs.jsonl");


        // let mut blocks_in_mem: Vec<String> = Vec::new();
        // let mut blocks_json_in_mem: Vec<String> = Vec::new();
        // let mut blocks_in_mem_id: HashSet<u64> = HashSet::with_capacity(50_000);

        // loop {
        //     // 1) Descargar HTML (como texto)
        //     let mut req = client.get(url);
        //     if !user.is_empty() && !pass.is_empty() {
        //         req = req.basic_auth(user, Some(pass));
        //     }

        //     match req.send().await {
        //         Ok(resp) => {
        //             let status = resp.status();
        //             let html_coded = resp.text().await.unwrap_or_default();
        //             let html = decode_html_entities(&html_coded).into_owned();

        //             if !status.is_success() || html.is_empty() {

        //                 eprintln!("aviso: http={} bytes={} (reintento)", status.as_u16(), html.len());

        //             } else {

        //                 let new_blocks: Vec<String> = get_regex("re_block")
        //                     .expect("regex no inicializado")
        //                     .find_iter(&html) 
        //                     .map(|m| m.as_str().trim_end().to_string())
        //                     .collect();

        //                 let mut appended_blocks: Vec<String> = Vec::new();

        //                 for blk in new_blocks {
        //                     let id = cap_str(get_regex("re_tx_id"), &blk).unwrap_or("0".to_string()).trim().parse::<u64>().unwrap_or(0);
        //                     if blocks_in_mem_id.insert(id) {
        //                         let mut to_write = blk.replace('\n', "\r\n");
        //                         to_write.push_str("\r\n");
        //                         raw_logs.write_all(to_write.as_bytes()).expect("Error writing raw log");
        //                         appended_blocks.push(blk);
        //                     }
        //                 }

        //                 if !appended_blocks.is_empty() {
        //                     blocks_in_mem.append(&mut appended_blocks);
        //                     let mut json_blocks = append_json_for_blocks(
        //                         &appended_blocks,
        //                         &mut json_logs,
        //                     ).expect("Error writing json log");
        //                     blocks_json_in_mem.append(&mut json_blocks);
        //                 }
        //             }

        //         }
        //         Err(e) => {
        //             eprintln!("request error: {e}");
        //             eprintln!("{e:#?}");
        //         }
        //     }
        //     tokio::time::sleep(Duration::from_secs(interval_secs)).await;
        // }
    

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod utils;
mod proxy_transport;
mod management_login;
mod proxy_network;
mod credential_vault;
mod credentials;
mod app_updates;
use app_updates::{check_app_update, download_app_update, open_update_folder, has_update_token, save_update_token, delete_update_token, UpdateState};
mod backup_store;
mod backup_manager;
mod ssh_client;
mod ssh_target;
mod policy_model;
mod policy_remote;
mod policy_manager;
use policy_manager::{
    PolicyState, get_policy_settings, save_policy_settings, inspect_policies,
    read_policy_snapshot, read_central_policy, save_central_policy,
    compare_policy_text, get_policy_progress, distribute_policy,
};
mod ssh_console;
use ssh_console::{ConsoleState, get_ssh_session, continue_ssh_console, close_other_ssh_profiles, connect_ssh_console, list_ssh_sessions, send_ssh_input, disconnect_ssh_console, interrupt_ssh_console, read_ssh_output, remove_ssh_session};
use backup_manager::{start_backup, list_backups, read_backup, delete_backup, open_backup_folder, get_backup_status, BackupState};
use credentials::{read_management_credentials, save_management_credentials, delete_management_credentials};
use proxy_transport::clear_management_sessions;
#[cfg(target_os = "linux")]
mod embedded_linux;
mod embedded_auth;
mod embedded_shortcuts;
use embedded_shortcuts::{ShortcutState, embedded_set_shortcuts};
mod embedded_browser;
use embedded_browser::{EmbeddedState, embedded_open, embedded_list, embedded_present, embedded_hide, embedded_reset_session, embedded_close, embedded_focus};
mod traffic_pdf;
use traffic_pdf::{save_traffic_pdf, open_traffic_pdf};
mod traffic_analysis;
mod traffic_store;
mod traffic_stream;
use crate::traffic_analysis::{
    abort_access_log_parse, append_access_log_parse_chunk, get_mock_access_log,
    get_traffic_processing_config, list_traffic_analyses, load_traffic_analysis, parse_access_log,
    save_traffic_analysis, start_access_log_parse, AccessLogParseState,
};
use crate::traffic_store::query_traffic_capture;
use crate::traffic_stream::{get_traffic_access_logs, start_traffic_stream, stop_traffic_stream, TrafficStreamState};
use regex::Regex;
use serde::Serialize;
use std::{fs::{self, OpenOptions}, io::Write, path::{ PathBuf}, time::Duration,  collections::{HashSet }};
use proxy_network::TraceLog;
use crate::utils::{append_json_for_blocks, cap_str, get_regex};
use tokio_util::sync::CancellationToken;

use tauri::{Manager, AppHandle, Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PacSourceResponse {
    requested_url: String,
    final_url: String,
    status: u16,
    etag: Option<String>,
    last_modified: Option<String>,
    content: String,
}

#[tauri::command]
async fn fetch_pac_source(url: String) -> Result<PacSourceResponse, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("Invalid PAC URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none()
        || !parsed.username().is_empty() || parsed.password().is_some()
    {
        return Err("The source must be a valid HTTP(S) URL without embedded credentials.".into());
    }
    const MAX_PAC_BYTES: usize = 512 * 1024;
    let client = reqwest::Client::builder()
        .user_agent("SymantecProxyApp PAC manager")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|error| format!("Could not prepare the PAC source connection: {error}"))?;
    let mut response = client.get(parsed.clone()).send().await
        .map_err(|error| format!("Could not download the PAC source: {error}"))?;
    let status = response.status();
    let final_url = response.url().to_string();
    let etag = response.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let last_modified = response.headers().get(reqwest::header::LAST_MODIFIED).and_then(|v| v.to_str().ok()).map(str::to_owned);
    if !status.is_success() {
        return Err(format!("The PAC source returned HTTP {}.", status.as_u16()));
    }
    if response.content_length().is_some_and(|size| size > MAX_PAC_BYTES as u64) {
        return Err("The PAC source exceeds the 512 KiB limit.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("Could not read the PAC source: {error}"))? {
        if bytes.len() + chunk.len() > MAX_PAC_BYTES {
            return Err("The PAC source exceeds the 512 KiB limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let content = String::from_utf8(bytes).map_err(|_| "The PAC source is not valid UTF-8 text.".to_string())?;
    Ok(PacSourceResponse { requested_url: parsed.to_string(), final_url, status: status.as_u16(), etag, last_modified, content })
}

#[tauri::command]
async fn getproxystatus(hostname: &str) -> Result<TraceLog, String> {
    proxy_network::check_proxy(hostname).await
}

fn check_cache_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    // Obtiene el directorio de caché para la app
    let path: PathBuf = app.path().app_cache_dir().expect("No hay cache_dir");
    // Asegura que exista la carpeta
    fs::create_dir_all(&path)?;
    Ok(path)
}

#[tauri::command]
fn get_app_cache_paths(app: AppHandle) -> Result<AppCachePaths, String> {
    let directory = app.path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve the application cache directory: {error}"))
        ?;
    Ok(AppCachePaths {
        traffic_analysis: directory.join("traffic-analysis").display().to_string(),
        raw_log: directory.join("rawLogs.log").display().to_string(),
        json_log: directory.join("logs.jsonl").display().to_string(),
        directory: directory.display().to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppCachePaths {
    traffic_analysis: String,
    directory: String,
    raw_log: String,
    json_log: String,
}

#[derive(Serialize)]
struct Logs {
    json: Vec<String>,
    raw: Vec<String>
}

#[derive(Default)]
struct LogWorkerState {
    cancel: std::sync::Mutex<Option<tokio_util::sync::CancellationToken>>,
}

fn describe_request_error(action: &str, url: &reqwest::Url, error: reqwest::Error) -> String {
    if let Some(status) = error.status() {
        return match status.as_u16() {
            401 => format!("Authentication failed while {action} (HTTP 401). Check the saved proxy credentials."),
            403 => format!("The proxy denied the request while {action} (HTTP 403)."),
            _ => format!("The proxy returned HTTP {status} while {action} from {url}."),
        };
    }

    if error.is_timeout() {
        return format!("The request timed out while {action} from {url}. Check the proxy availability and network connection.");
    }

    if error.is_connect() {
        return format!("Could not connect while {action} from {url}. Check the proxy address, port, network access, and TLS compatibility. Details: {error}");
    }

    format!("Could not complete the request while {action} from {url}. Details: {error}")
}

fn describe_status_error(action: &str, url: &reqwest::Url, status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 => format!("Authentication failed while {action} (HTTP 401). Check the saved proxy credentials."),
        403 => format!("The proxy denied the request while {action} (HTTP 403)."),
        _ => format!("The proxy returned HTTP {status} while {action} from {url}."),
    }
}

fn proxy_base_url(proxy_host: &str) -> Result<reqwest::Url, String> {
    let proxy_host = proxy_host.trim();
    if proxy_host.is_empty() {
        return Err("A proxy hostname or IP address is required.".into());
    }
    let authority = match proxy_host.parse::<std::net::Ipv6Addr>() {
        Ok(ip) => format!("[{ip}]"),
        Err(_) => proxy_host.to_string(),
    };
    let base = reqwest::Url::parse(&format!("https://{authority}:8082/"))
        .map_err(|error| format!("Invalid proxy address: {error}"))?;
    if !base.username().is_empty()
        || base.password().is_some()
        || base.port() != Some(8082)
        || base.path() != "/"
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("Enter a hostname or IP address without a URL or path.".into());
    }
    Ok(base)
}

#[tauri::command]
async fn start_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogWorkerState>, 
    ippr: &str, 
    proxy_ip: &str,
    userpr: &str, 
    passpr: &str,
    use_mock_data: bool,
) -> Result<(), String> {
    println!("start logs is running");
    let url = if use_mock_data {
        "http://127.0.0.1:5500/Policy/Trace/etuyon.html".to_string()
    } else {
        let base = proxy_base_url(proxy_ip)?;
        let trace_url = reqwest::Url::parse(ippr)
            .map_err(|error| format!("Invalid selected trace URL: {error}"))?;
        if trace_url.scheme() != "https"
            || trace_url.host_str() != base.host_str()
            || trace_url.port() != Some(8082)
            || !trace_url.path().starts_with("/Policy/Trace/")
            || !trace_url.username().is_empty()
            || trace_url.password().is_some()
        {
            return Err("The selected trace must belong to the configured proxy.".into());
        }
        trace_url.to_string()
    };

    {
        let mut guard = state.cancel.lock().unwrap();
        if guard.is_some() { return Err("ya está corriendo".into()); }
        *guard = Some(CancellationToken::new());
    }
    let token = state.cancel.lock().unwrap().as_ref().unwrap().clone();

    let user = userpr.to_string();
    let pass = passpr.to_string();
    let interval_secs = 5;
    

    let request_url = reqwest::Url::parse(&url).map_err(|_| "Invalid trace URL.")?;
    let client = match proxy_transport::authenticated_client_for(&request_url, &user, &pass, use_mock_data).await {
        Ok(client) => client,
        Err(error) => { state.cancel.lock().unwrap().take(); return Err(error); }
    };
    tauri::async_runtime::spawn(async move {
        let cache_dir = match check_cache_dir(&app) {
            Ok(p) => p,
            Err(e) => { let _ = app.emit("logs:error", &format!("cache_dir: {e}")); return; }
        };

        println!("cache_dir: {}", cache_dir.display());

        let mut raw_logs = OpenOptions::new().create(true).append(true)
            .open(cache_dir.join("rawLogs.log")).expect("raw open");
        let mut json_logs = OpenOptions::new().create(true).append(true)
            .open(cache_dir.join("logs.jsonl")).expect("json open");

        let mut ids: HashSet<u64> = HashSet::with_capacity(50_000);
        let mut last_error: Option<String> = None;

        println!("starting log worker for url: {}", url);
        while !token.is_cancelled() {
            let req = client.get(&url);
            println!("requesting: {}", url);
            match req.send().await {
                Ok(resp) => {
                    if token.is_cancelled() { break; }
                    let status = resp.status();
                    if !status.is_success() {
                        let request_url = reqwest::Url::parse(&url).unwrap();
                        let message = describe_status_error("fetching trace data", &request_url, status);
                        if last_error.as_deref() != Some(message.as_str()) {
                            let _ = app.emit("logs:error", &message);
                        }
                        last_error = Some(message);
                        if status == reqwest::StatusCode::UNAUTHORIZED {
                            proxy_transport::invalidate(&request_url, &user, &pass, use_mock_data);
                            break;
                        }
                        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
                        continue;
                    }
                    let html_coded = match resp.text().await {
                        Ok(text) => text,
                        Err(error) => {
                            let request_url = reqwest::Url::parse(&url).unwrap();
                            let message = describe_request_error("reading trace data", &request_url, error);
                            if last_error.as_deref() != Some(message.as_str()) {
                                let _ = app.emit("logs:error", &message);
                            }
                            last_error = Some(message);
                            tokio::time::sleep(Duration::from_secs(interval_secs)).await;
                            continue;
                        }
                    };
                    if token.is_cancelled() { break; }
                    if let Err(message) = proxy_transport::check_document(&html_coded, &request_url, &user, &pass, use_mock_data) {
                        let _ = app.emit("logs:error", &message);
                        break;
                    }
                    last_error = None;
                    let html = html_escape::decode_html_entities(&html_coded).into_owned();

                    if !html.is_empty() {
                    let new_blocks: Vec<String> = get_regex("re_block")
                            .expect("regex no inicializado")
                            .find_iter(&html) 
                            .map(|m| m.as_str().trim_end().to_string())
                            .collect();
                    println!("🔍 Bloques encontrados: {}", new_blocks.len());
                    let mut appended_blocks: Vec<String> = Vec::new();
                    for blk in new_blocks {
                        let id: u64 = cap_str(get_regex("re_tx_id"), &blk).unwrap_or("0".to_string()).trim().parse::<u64>().unwrap_or(0);
                        if ids.insert(id) {
                            let mut to_write = blk.replace('\n', "\r\n");
                            to_write.push_str("\r\n");
                            raw_logs.write_all(to_write.as_bytes()).expect("raw write error");
                            appended_blocks.push(blk);
                        }
                    }
                    if !appended_blocks.is_empty() {
                        let appended_json: Vec<String> = append_json_for_blocks(&appended_blocks, &mut json_logs).unwrap();
                        let _ = app.emit("logs:update", &Logs {
                            json: appended_json,
                            raw: appended_blocks,
                        });
                    }
                }
                }
                Err(error) => {
                    let request_url = reqwest::Url::parse(&url).unwrap();
                    let message = describe_request_error("fetching trace data", &request_url, error);
                    if last_error.as_deref() != Some(message.as_str()) {
                        let _ = app.emit("logs:error", &message);
                    }
                    last_error = Some(message);
                }
            }
            tokio::time::sleep(Duration::from_secs(interval_secs)).await;
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_logs(state: State<'_, LogWorkerState>) -> Result<(), String> {
    if let Some(token) = state.cancel.lock().unwrap().take() {
        token.cancel();
    }
    Ok(())
}



// use regex::Regex;
// use serde::Serialize;

#[derive(Serialize)]
struct HtmlData {
    #[serde(rename = "filesLink")]
    files_link: Vec<FileLink>,
    traces: Vec<TraceItem>,
}

#[derive(Serialize)]
struct FileLink {
    name: String,
    content: String,
}

#[derive(Serialize)]
struct TraceItem {
    trace: String,
    url: String,
}

#[tauri::command]
async fn get_html_data(
    ippr: &str,
    userpr: &str,
    passpr: &str,
    use_mock_data: bool,
) -> Result<HtmlData, String> {

    let proxy_base = if use_mock_data {
        None
    } else {
        Some(proxy_base_url(ippr)?)
    };
    let url = if use_mock_data {
        reqwest::Url::parse("http://127.0.0.1:5500/Policy.html")
            .expect("static mock URL is valid")
    } else {
        proxy_base
            .as_ref()
            .expect("live mode has a validated proxy URL")
            .join("Policy")
            .map_err(|error| format!("Could not build policy URL: {error}"))?
    };

    let client = proxy_transport::authenticated_client_for(&url, userpr, passpr, use_mock_data).await?;
    let policy_request = client.get(url.clone()).timeout(Duration::from_secs(30));
    let policy_response = policy_request.send().await.map_err(|error| {
        describe_request_error("fetching the policy index", &url, error)
    })?;
    if policy_response.status() == reqwest::StatusCode::UNAUTHORIZED { proxy_transport::invalidate(&url, userpr, passpr, use_mock_data); }
    let policy_response = policy_response.error_for_status().map_err(|error| {
        describe_request_error("fetching the policy index", &url, error)
    })?;
    let html = policy_response.text().await.map_err(|error| {
        describe_request_error("reading the policy index", &url, error)
    })?;
    proxy_transport::check_document(&html, &url, userpr, passpr, use_mock_data)?;

    let html = html_escape::decode_html_entities(&html).into_owned();

    let re_link = Regex::new(r#"<a\s+href="([^"]+)">([^<]+)</a>"#).unwrap();
    let re_pre = Regex::new(r#"(?is)<pre[^>]*>(.*?)</pre>"#).unwrap();

    let mut files = Vec::new();
    let mut traces = Vec::new();

    for cap in re_link.captures_iter(&html) {
        
        let href = cap.get(1).unwrap().as_str();
        let name = cap.get(2).unwrap().as_str().trim();

        // -------- ignorar ----------
        if href.contains("Statistics")
            || href.contains("Coverage")
            || href.contains("classification")
            || href.contains("Reset-Stats")
        {
            continue;
        }

        // -------- traces ----------
        if href.starts_with("/Policy/Trace/") {

            traces.push(TraceItem {
                trace: name.to_string(),
                url: match &proxy_base {
                    Some(proxy_base) => proxy_base
                        .join(href)
                        .map_err(|error| format!("Invalid trace link: {error}"))?
                        .to_string(),
                    None => reqwest::Url::parse("http://127.0.0.1:5500/")
                        .expect("static mock base URL is valid")
                        .join(href)
                        .map_err(|error| format!("Invalid mock trace link: {error}"))?
                        .to_string(),
                },
            });

            continue;
        }

        // -------- files ----------
        let file_url = if use_mock_data {
            let mock_base = reqwest::Url::parse("http://127.0.0.1:5500/")
                .expect("static mock base URL is valid");
            let mut file_url = mock_base
                .join(href)
                .map_err(|error| format!("Invalid mock policy link: {error}"))?;
            // The local fixture exposes its current-policy page as Policy.html.
            if file_url.path().trim_end_matches('/') == "/Policy/Current" {
                file_url = mock_base
                    .join("Policy.html")
                    .expect("static mock policy URL is valid");
            }
            if file_url.scheme() != mock_base.scheme()
                || file_url.host_str() != mock_base.host_str()
                || file_url.port() != mock_base.port()
            {
                continue;
            }
            file_url
        } else {
            let file_url = proxy_base
                .as_ref()
                .expect("live mode has a validated proxy URL")
                .join(href)
                .map_err(|error| format!("Invalid policy link: {error}"))?;
            if file_url.scheme() != "https"
                || file_url.host_str()
                    != proxy_base
                        .as_ref()
                        .expect("live mode has a validated proxy URL")
                        .host_str()
                || file_url.port() != Some(8082)
                || !file_url.username().is_empty()
                || file_url.password().is_some()
            {
                continue;
            }
            file_url
        };
        let file_request = client.get(file_url.clone()).timeout(Duration::from_secs(30));
        let response = file_request.send().await.map_err(|error| {
            describe_request_error(&format!("fetching policy file '{name}'"), &file_url, error)
        })?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED { proxy_transport::invalidate(&url, userpr, passpr, use_mock_data); }
        // Mock policy indexes can list appliance files that are not included
        // in the local fixture. Keep loading the available mock data instead
        // of failing the entire Diagnostics request on those missing files.
        if use_mock_data && response.status() == reqwest::StatusCode::NOT_FOUND {
            continue;
        }
        let response = response.error_for_status().map_err(|error| {
            describe_request_error(&format!("fetching policy file '{name}'"), &file_url, error)
        })?;
        let text = response.text().await.map_err(|error| {
            describe_request_error(&format!("reading policy file '{name}'"), &file_url, error)
        })?;
        proxy_transport::check_document(&text, &file_url, userpr, passpr, use_mock_data)?;
        let text = html_escape::decode_html_entities(&text).into_owned();
        let content = if let Some(cap) = re_pre.captures(&text) {
            cap.get(1)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default()
        } else {
            text
        };
        
        files.push(FileLink {
            name: name.to_string(),
            content,
        });




        // let file_url = format!("https://{}:8082{}", ippr, href);

        // let response = match client
        //     .get(&file_url)
        //     .basic_auth(userpr, Some(passpr))
        //     .send()
        //     .await
        // {
        //     Ok(r) => r,
        //     Err(_) => continue,
        // };

        // let text = match response.text().await {
        //     Ok(t) => t,
        //     Err(_) => continue,
        // };

        // let text = html_escape::decode_html_entities(&text).into_owned();

        // let content = if let Some(cap) = re_pre.captures(&text) {
        //     cap.get(1).unwrap().as_str().trim().to_string()
        // } else {
        //     text
        // };

        // files.push(FileLink {
        //     name: name.to_string(),
        //     content,
        // });
    }

    Ok(HtmlData {
        files_link: files,
        traces,
    })
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    tauri::Builder::default()
    .manage(UpdateState::default())
    .manage(LogWorkerState::default())
    .manage(BackupState::default())
    .manage(ConsoleState::default())
    .manage(EmbeddedState::default())
    .manage(ShortcutState::default())
    .manage(PolicyState::default())
    .on_window_event(|window, event| {
        backup_manager::on_window_event(window, event);
        if window.label() == "main" && window.state::<PolicyState>().running() {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("policy:close-blocked", "Wait for policy distribution to finish before closing.");
            }
        }
    })
    .manage(TrafficStreamState::default())
    .manage(AccessLogParseState::default())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![embedded_set_shortcuts, save_traffic_pdf, open_traffic_pdf, get_policy_settings, save_policy_settings, inspect_policies, read_policy_snapshot, read_central_policy, save_central_policy, compare_policy_text, get_policy_progress, distribute_policy, get_ssh_session, continue_ssh_console, close_other_ssh_profiles, connect_ssh_console, list_ssh_sessions, send_ssh_input, disconnect_ssh_console, interrupt_ssh_console, read_ssh_output, remove_ssh_session, check_app_update, download_app_update, open_update_folder, has_update_token, save_update_token, delete_update_token, start_backup, list_backups, read_backup, delete_backup, open_backup_folder, get_backup_status, read_management_credentials, save_management_credentials, delete_management_credentials, clear_management_sessions, getproxystatus, start_logs, stop_logs, embedded_open, embedded_list, embedded_present, embedded_hide, embedded_reset_session, embedded_close, embedded_focus, get_html_data, fetch_pac_source, get_app_cache_paths, save_traffic_analysis, load_traffic_analysis, list_traffic_analyses, parse_access_log, get_mock_access_log, get_traffic_access_logs, start_traffic_stream, stop_traffic_stream, start_access_log_parse, append_access_log_parse_chunk, abort_access_log_parse, get_traffic_processing_config, query_traffic_capture])
    .run(context)
    .expect("error while running tauri application");
}
