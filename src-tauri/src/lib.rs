

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
async fn open_proxy(app: tauri::AppHandle, url: String)  -> tauri::Result<()>{
  WebviewWindowBuilder::new(
      &app,
      "tab-viewer".to_string(),
      WebviewUrl::External(url.parse().unwrap())
  )
  .title("Nueva pestaña")
  .inner_size(1200.0, 800.0)
  .resizable(true)
  .build()
  .unwrap();

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

#[tauri::command]
async fn start_logs(
    app: tauri::AppHandle,
    state: tauri::State<'_, LogWorkerState>, 
    ippr: &str, 
    userpr: &str, 
    passpr: &str
) -> Result<(), String> {
    {
        let mut guard = state.cancel.lock().unwrap();
        if guard.is_some() { return Err("ya está corriendo".into()); }
        *guard = Some(CancellationToken::new());
    }
    let token = state.cancel.lock().unwrap().as_ref().unwrap().clone();

    let ip = ippr.to_string();
    // let url = format!("https://{}:8082/Policy/Trace/proxytools", ip);
    let url = "http://127.0.0.1:5500/".to_string();
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

        while !token.is_cancelled() {
            let mut req = client.get(&url);
            if !user.is_empty() && !pass.is_empty() { 
                req = req.basic_auth(&user, Some(&pass)); 
            }

            if let Ok(resp) = req.send().await {
                let status = resp.status();
                let html_coded = resp.text().await.unwrap_or_default();
                let html = html_escape::decode_html_entities(&html_coded).into_owned();

                if status.is_success() && !html.is_empty() {
                    let new_blocks: Vec<String> = get_regex("re_block")
                            .expect("regex no inicializado")
                            .find_iter(&html) 
                            .map(|m| m.as_str().trim_end().to_string())
                            .collect();

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


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
    .manage(LogWorkerState::default())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![getproxystatus, start_logs, stop_logs, open_proxy])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
