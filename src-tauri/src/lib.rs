

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
use regex::Regex;
use serde::Serialize;
use std::{fs::{self, OpenOptions}, io::Write, path::{ PathBuf}, sync::{Arc}, time::Duration,  collections::{HashSet }};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use chrono::Utc;
use tokio::process::Command;
use crate::utils::{append_json_for_blocks, cap_str, get_regex};
use tokio_util::sync::CancellationToken;

use tauri::{ WebviewUrl, WebviewWindowBuilder,Manager, AppHandle, Emitter,  State};

#[tauri::command]
async fn open_proxy(
  app: tauri::AppHandle,
  url: String,
  username: String,
  password: String,
) -> tauri::Result<()> {
  let url: tauri::Url = url.parse().map_err(tauri::Error::InvalidUrl)?;
  let window = WebviewWindowBuilder::new(
      &app,
      "tab-viewer".to_string(),
      WebviewUrl::External("about:blank".parse().unwrap())
  )
  .title("Nueva pestaña")
  .inner_size(1200.0, 800.0)
  .resizable(true)
  .build()?;

  #[cfg(not(target_os = "windows"))]
  {
    window.navigate(url)?;
    return Ok(());
  }

  #[cfg(target_os = "windows")]
  window.with_webview(move |webview| {
    unsafe {
      use webview2_com::{
        BasicAuthenticationRequestedEventHandler,
        Microsoft::Web::WebView2::Win32::ICoreWebView2_10,
      };
      use windows::core::{Interface, PCWSTR};

      let controller = webview.controller();
      let core_webview = match controller.CoreWebView2() {
        Ok(core_webview) => core_webview,
        Err(error) => {
          eprintln!("Failed to get WebView2 instance: {error}");
          return;
        }
      };
      let webview_with_auth = match core_webview.cast::<ICoreWebView2_10>() {
        Ok(webview) => webview,
        Err(error) => {
          eprintln!("WebView2 BasicAuthenticationRequested is unavailable: {error}");
          return;
        }
      };

      let auth_handler = BasicAuthenticationRequestedEventHandler::create(Box::new(
        move |_sender, args| {
          if let Some(args) = args {
            let response = args.Response()?;
            let username_wide: Vec<u16> = username
              .encode_utf16()
              .chain(std::iter::once(0))
              .collect();
            let password_wide: Vec<u16> = password
              .encode_utf16()
              .chain(std::iter::once(0))
              .collect();
            response.SetUserName(PCWSTR::from_raw(username_wide.as_ptr()))?;
            response.SetPassword(PCWSTR::from_raw(password_wide.as_ptr()))?;
          }
          Ok(())
        },
      ));

      let mut event_token = 0;
      if let Err(error) = webview_with_auth.add_BasicAuthenticationRequested(
        &auth_handler,
        &mut event_token,
      ) {
        eprintln!("Failed to register WebView2 authentication handler: {error}");
        return;
      }

      let url_wide: Vec<u16> = url
        .as_str()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
      if let Err(error) = core_webview.Navigate(PCWSTR::from_raw(url_wide.as_ptr())) {
        eprintln!("Failed to navigate proxy window: {error}");
        let _ = webview_with_auth.remove_BasicAuthenticationRequested(event_token);
      }
    }
  })?;

  Ok(())
}

#[derive(Serialize)]
struct TraceLog {
    pinglog: String,
    hostname: String,
    nslookup: String,
    active: bool,
    last_check: String,
    hostinfo: HostInfo
}

#[derive(Serialize)]
struct HostInfo {
    hostname: String,
    ip: String,
    dnsname: String,
    dnsip: String,
}

fn get_host_info(nslookup: &str) -> Option<HostInfo> {
    let regexnslookup = Regex::new(
    r"Server:\s*(?P<server>\S+)\r?\nAddress?:\s*(?P<server_ip>\S+)\r?\n\r?\nName:\s*(?P<host>\S+)\r?\nAddress(?:es)?:\s*(?P<host_ip>(?:\S+(?:\r?\n\s+\S+)*)?)"
    ).unwrap();
 
    let results = match regexnslookup.captures(nslookup) {
        Some(caps) => {
            let dns   = caps.name("server").map(|m| m.as_str()).unwrap_or("unkown");
            let dns_ip = caps.name("server_ip").map(|m| m.as_str()).unwrap_or("unkown");
            let host     = caps.name("host").map(|m| m.as_str()).unwrap_or("unkown");
            let host_ip  = caps.name("host_ip").map(|m| m.as_str()).unwrap_or("unkown");
            HostInfo {
                hostname: host.to_string(),
                ip: host_ip.to_string(),
                dnsname: dns.to_string(),
                dnsip: dns_ip.to_string(),
            }
        }
        None => HostInfo { hostname: "unknown".to_string(), ip: "unknown".to_string(), dnsname: "unknown".to_string(), dnsip: "unknown".to_string() }
    };

    return Some(results);
}



#[tauri::command]
async fn getproxystatus(hostname: &str) -> Result<TraceLog, String> {
    // Ejecuta y espera ambos procesos
    println!("pinging {}", hostname);
    let outputping = Command::new("ping.exe")
        .args(&["-n", "4", hostname])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let outputhostname = Command::new("nslookup.exe")
        .arg(hostname)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // Parseos
    let stdoutping = String::from_utf8_lossy(&outputping.stdout);
    let stdoutnslookup = String::from_utf8_lossy(&outputhostname.stdout);

    let packetloss = Regex::new("100% loss").unwrap();
    let timeoutregex = Regex::new("Request timed out.").unwrap();
    let unreachable = Regex::new("unreachable.").unwrap();
    let notfound = Regex::new("Ping request could not find host").unwrap();

    let active = !(packetloss.is_match(&stdoutping) || timeoutregex.is_match(&stdoutping) || unreachable.is_match(&stdoutping) || notfound.is_match(&stdoutping));
    let hostinfo = get_host_info(&stdoutnslookup).expect("Error getting host info");  
    
    println!("hostname?: {}", hostinfo.hostname.split('.').collect::<Vec<&str>>()[0].to_string());
    
    Ok( 
        TraceLog {
            pinglog: stdoutping.to_string(),
            hostname: hostinfo.hostname.split('.').collect::<Vec<&str>>()[0].to_string(),
            nslookup: stdoutnslookup.to_string(),
            active,
            last_check: Utc::now().to_rfc3339(),
            hostinfo
        } 
    )
}

fn check_cache_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    // Obtiene el directorio de caché para la app
    let path: PathBuf = app.path().app_cache_dir().expect("No hay cache_dir");
    // Asegura que exista la carpeta
    fs::create_dir_all(&path)?;
    Ok(path)
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
    

    tauri::async_runtime::spawn(async move {
        let jar = Arc::new(CookieStoreMutex::new(CookieStore::default()));
        let client = reqwest::Client::builder()
            .cookie_provider(jar)
            .user_agent("trace-tools/0.1")
            .danger_accept_invalid_certs(true)
            .build()
            .expect("client");

        let cache_dir = match check_cache_dir(&app) {
            Ok(p) => p,
            Err(e) => { let _ = app.emit("logs:error", &format!("cache_dir: {e}")); return; }
        };

        println!("cache_dir: {}", cache_dir.display());

        let mut raw_logs = OpenOptions::new().create(true).append(true)
            .open(cache_dir.join("rawLogs.log")).expect("raw open");
        let mut json_logs = OpenOptions::new().create(true).append(true)
            .open(cache_dir.join("logs.jsonl")).expect("json open");

        let mut blocks_in_mem: Vec<String> = Vec::new();
        let mut blocks_json_in_mem: Vec<String> = Vec::new();
        let mut ids: HashSet<u64> = HashSet::with_capacity(50_000);
        let mut last_error: Option<String> = None;

        println!("starting log worker for url: {}", url);
        while !token.is_cancelled() {
            let mut req = client.get(&url);
            if !user.is_empty() && !pass.is_empty() { 
                req = req.basic_auth(&user, Some(&pass)); 
            }
            println!("requesting: {}", url);
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if !status.is_success() {
                        let request_url = reqwest::Url::parse(&url).unwrap();
                        let message = describe_status_error("fetching trace data", &request_url, status);
                        if last_error.as_deref() != Some(message.as_str()) {
                            let _ = app.emit("logs:error", &message);
                        }
                        last_error = Some(message);
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
                        blocks_in_mem.extend(appended_blocks.clone());
                        let appended_json: Vec<String> = append_json_for_blocks(&appended_blocks, &mut json_logs).unwrap();
                        blocks_json_in_mem.extend(appended_json.clone());
                        println!("blocks in mem: {}", blocks_in_mem.len());
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
    filesLink: Vec<FileLink>,
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

    let jar = Arc::new(CookieStoreMutex::new(CookieStore::default()));
    let client = reqwest::Client::builder()
        .cookie_provider(jar)
        .user_agent("trace-tools/0.1")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|error| format!("Could not prepare the proxy request: {error}"))?;

    let mut policy_request = client.get(url.clone());
    if !userpr.is_empty() && !passpr.is_empty() {
        policy_request = policy_request.basic_auth(userpr, Some(passpr));
    }
    let policy_response = policy_request.send().await.map_err(|error| {
        describe_request_error("fetching the policy index", &url, error)
    })?;
    let policy_response = policy_response.error_for_status().map_err(|error| {
        describe_request_error("fetching the policy index", &url, error)
    })?;
    let html = policy_response.text().await.map_err(|error| {
        describe_request_error("reading the policy index", &url, error)
    })?;

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
                    None => format!("https://{ippr}:8082{href}"),
                },
            });

            continue;
        }

        // -------- files ----------
        let file_url = if use_mock_data {
            let mock_base = reqwest::Url::parse("http://127.0.0.1:5500/")
                .expect("static mock base URL is valid");
            let file_url = mock_base
                .join(href)
                .map_err(|error| format!("Invalid mock policy link: {error}"))?;
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
        let mut file_request = client.get(file_url.clone());
        if !userpr.is_empty() && !passpr.is_empty() {
            file_request = file_request.basic_auth(userpr, Some(passpr));
        }
        let response = file_request.send().await.map_err(|error| {
            describe_request_error(&format!("fetching policy file '{name}'"), &file_url, error)
        })?;
        let response = response.error_for_status().map_err(|error| {
            describe_request_error(&format!("fetching policy file '{name}'"), &file_url, error)
        })?;
        let text = response.text().await.map_err(|error| {
            describe_request_error(&format!("reading policy file '{name}'"), &file_url, error)
        })?;
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
        filesLink: files,
        traces,
    })
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .manage(LogWorkerState::default())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![getproxystatus, start_logs, stop_logs, open_proxy, get_html_data])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
