// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// use serde_json::json;
// use std::{fs::{self, OpenOptions}, io::Write, path::Path, sync::Arc, time::Duration};
// use regex::Regex;
// use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
// use std::mem;
// use html_escape::decode_html_entities;

// #[tokio::main]



fn main()  {
    proxytools_lib::run();
}
// async fn main() -> anyhow::Result<()> {
//     trace_log_interface_lib::run();

//     // === CONFIG - igual que vos, cambiá lo que necesites ===
//     const URL: &str  = "https://10.190.2.27:8082/Policy/Trace/TraceJaen";
//     const USER: &str = "etuyon";
//     const PASS: &str = "jGkGHAKmT$W3Cb&kEwtd";
//     const OUT: &str  = r"C:\Users\ETUYON\Desktop\trace logs\rawLogs.log";
//     const JSON_OUT: &str  = r"C:\Users\ETUYON\Desktop\trace logs\logs.jsonl";
//     const INTERVAL_SECS: u64 = 5;

//     // === Cliente HTTP (con jar, UA y certs inseguros) ===
//     let jar = Arc::new(CookieStoreMutex::new(CookieStore::default()));
//     let client = reqwest::Client::builder()
//         .cookie_provider(jar)
//         .user_agent("trace-tools/0.1")
//         .danger_accept_invalid_certs(true) // SOLO pruebas
//         .build()?;

//     // === Aseguramos carpeta y archivo de salida ===
//     if let Some(dir) = Path::new(OUT).parent() { fs::create_dir_all(dir)?; }
//     let mut out = OpenOptions::new().create(true).append(true).open(OUT)?;
//     // === Aseguramos carpeta y archivo de salida json ===
//     if let Some(dir) = Path::new(JSON_OUT).parent() { fs::create_dir_all(dir)?; }
//     let mut json_out = OpenOptions::new().create(true).append(true).open(JSON_OUT)?;

//     // === Regex precompiladas ===
//     // quita etiquetas HTML: cualquier <...> (multilínea)
//     let re_tags = Regex::new(r"(?is)</?[a-z][a-z0-9]*(\s+[^<>]*?)?>").expect("regex etiquetas");
//     // bloque completo: desde línea "start transaction" hasta "stop transaction"
//     let re_block = Regex::new(r"(?ms)^start transaction.*?^stop transaction.*?$")
//         .expect("regex bloque");

//     // Campos estilo FormatTraceLogs.ps1
//     let re_tx_id: Regex      = Regex::new(r"(?mi)transaction ID=(\d+)").unwrap();
//     let re_tx_type: Regex    = Regex::new(r"(?m)\btype=([^\s]+)").unwrap();
//     let re_tx_from: Regex    = Regex::new(r"(?mi)transaction handed off from:\s*([0-9]+)").unwrap();
//     let re_tx_dest: Regex    = Regex::new(r"(?m)^\s*unknown\s+(\S+://\S+)").unwrap();
//     // **NUEVO**: destino también desde CONNECT …
//     let re_tx_connect: Regex = Regex::new(r"(?mi)^\s*CONNECT\s+(\S+)").unwrap();

//     let re_client_addr: Regex= Regex::new(r"(?m)\bclient\.address=(\d+\.\d+\.\d+\.\d+)").unwrap();
//     let re_source_port: Regex= Regex::new(r"(?m)\bsource\.port=(\d+)").unwrap();
//     let re_proxy_port: Regex = Regex::new(r"(?m)\bproxy\.port=(\d+)").unwrap();
//     let re_dest_port: Regex  = Regex::new(r"(?m)\bdest\.port=(\d+)").unwrap();
//     let re_client_if: Regex  = Regex::new(r"(?m)\bclient\.interface=([^\s]+)").unwrap();
//     let re_route_dom: Regex  = Regex::new(r"(?m)\brouting-domain=([^\s]+)").unwrap();
//     let re_time: Regex       = Regex::new(r"(?m)^\s*time:\s*([0-9-:\sA-Za-z]+)$").unwrap();

//     let re_user_name: Regex= Regex::new(r#"(?mi)\buser:\s+name\s*=\s*["']([^"']+)["']"#).unwrap();
//     let re_realm: Regex     = Regex::new(r"(?m)\brealm=([A-Za-z0-9_/-]+)").unwrap();
//     let re_authd: Regex     = Regex::new(r"(?m)\bauthenticated=(true|false)").unwrap();
//     let re_autzd: Regex     = Regex::new(r"(?m)\bauthorized=(true|false)").unwrap();
//     let re_rel_user: Regex  = Regex::new(r"(?m)relative username='([^']*)'").unwrap();

//     let re_app_name: Regex   = Regex::new(r"(?mi)application\.name:\s*([^\r\n]+)").unwrap();
//     let re_app_op: Regex     = Regex::new(r"(?mi)application\.operation:\s*([^\r\n]+)").unwrap();
//     let re_app_grp: Regex    = Regex::new(r"(?mi)application\.group:\s*([^\r\n]+)").unwrap();

//     let re_verdict: Regex    = Regex::new(r"(?mi)^\s*verdict:\s*([^\r\n]+)").unwrap();
//     let re_cats_raw: Regex   = Regex::new(r"(?mi)^\s*url\.category:\s*([^\r\n]+)").unwrap();
//     let re_catgr_raw: Regex  = Regex::new(r"(?mi)^\s*category groups:\s*([^\r\n]+)").unwrap();

//     // policyMatches: headers y líneas MATCH:
//     let re_hdr: Regex        = Regex::new(r"(?m)^\s*<[^>]+>\s*(?:\[[^\]]+\]\s*)+.*$").unwrap();
//     let re_match: Regex      = Regex::new(r"(?m)^\s*MATCH:\s*(.+)$").unwrap();

//     // **NUEVO**: Timing
//     let re_timing_total: Regex = Regex::new(r"(?mi)^Transaction timing:\s*total-transaction-time\s+(\d+)\s*ms").unwrap();
//     let re_checkpoint: Regex   = Regex::new(r"(?mi)^\s*([a-z0-9\-]+):\s*start\s+(\d+)\s+elapsed\s+(\d+)\s*ms").unwrap();
//     let re_urlcat_ms: Regex    = Regex::new(r"(?mi)^url_categorization complete time:\s*(\d+)").unwrap();
//     let re_client_bytes: Regex = Regex::new(r"(?mi)^client connection:\s*first-response-byte\s+(\d+)\s+last-response-byte\s+(\d+)").unwrap();

//     eprintln!("Log continuo desde {} cada {}s → {}\nJSON en: {}", URL, INTERVAL_SECS, OUT, JSON_OUT);

//     loop {
//         // 1) Descargar HTML (como texto)
//         let mut req = client.get(URL);
//         if !USER.is_empty() && !PASS.is_empty() {
//             req = req.basic_auth(USER, Some(PASS));
//         }

//         match req.send().await {
//             Ok(resp) => {
//                 let status = resp.status();
//                 let html_coded = resp.text().await.unwrap_or_default();
//                 let html = decode_html_entities(&html_coded).into_owned();

//                 if !status.is_success() || html.is_empty() {
//                     eprintln!("aviso: http={} bytes={} (reintento)", status.as_u16(), html.len());
//                 } else {
//                     // 2) Limpiar: quitar etiquetas → texto puro
//                     let cleaned = re_tags.replace_all(&html, "").to_string()
//                         .replace("\r\n", "\n").replace('\r', "\n");

//                     // 8) DESCARTAR cortadas: extraemos SOLO bloques completos del chunk actual
//                     let new_blocks: Vec<String> = re_block
//                         .find_iter(&cleaned)
//                         .map(|m| m.as_str().trim_end().to_string())
//                         .collect();

//                     // 6) Comparar con archivo actual: bloques ya existentes
//                     let existing_text = fs::read_to_string(OUT).unwrap_or_default()
//                         .replace("\r\n", "\n").replace('\r', "\n");
//                     let existing_blocks: std::collections::HashSet<String> = re_block
//                         .find_iter(&existing_text)
//                         .map(|m| m.as_str().trim_end().to_string())
//                         .collect();

//                     // 7) Agregar SOLO bloques nuevos (merge “solo nuevos”)
//                     let mut appended_blocks: Vec<String> = Vec::new();
//                     for blk in new_blocks {
//                         if !existing_blocks.contains(&blk) {
//                             let mut to_write = blk.replace('\n', "\r\n");
//                             to_write.push_str("\r\n");
//                             out.write_all(to_write.as_bytes())?;
//                             appended_blocks.push(blk); // guardamos el bloque para JSON
//                         }
//                     }

//                     if !appended_blocks.is_empty() {
//                         append_json_for_blocks(
//                             &appended_blocks,
//                             &mut json_out,
//                             &re_tx_id, &re_tx_type, &re_tx_from, &re_tx_dest, &re_tx_connect,
//                             &re_client_addr, &re_source_port, &re_proxy_port, &re_dest_port,
//                             &re_client_if, &re_route_dom, &re_time,
//                             &re_user_name, &re_realm, &re_authd, &re_autzd, &re_rel_user,
//                             &re_app_name, &re_app_op, &re_app_grp,
//                             &re_verdict, &re_cats_raw, &re_catgr_raw,
//                             &re_hdr, &re_match,
//                             &re_timing_total, &re_checkpoint, &re_urlcat_ms, &re_client_bytes
//                         )?;
//                     }
//                     eprintln!(
//                         "http=200, nuevos agregados RAW={}, JSONL+={} / archivos RAW={}, JSONL+={}",
//                         appended_blocks.len(), appended_blocks.len(), OUT, JSON_OUT
//                     );
//                 }
//             }
//             Err(e) => {
//                 eprintln!("request error: {e}");
//                 eprintln!("{e:#?}");
//             }
//         }

//         tokio::time::sleep(Duration::from_secs(INTERVAL_SECS)).await;
//     }
// }

// // ----- formatear a json ------

// fn cap_str(re: &Regex, s: &str) -> Option<String> {
//     re.captures(s).and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
// }

// fn split_semicolons(s: &str) -> Vec<String> {
//     s.split(';')
//         .map(|t| t.trim())
//         .filter(|t| !t.is_empty())
//         .map(|t| t.to_string())
//         .collect()
// }

// /// Convierte SOLO los bloques nuevos a objetos JSON (similar a FormatTraceLogs.ps1) y los appendea a JSON Lines
// fn append_json_for_blocks(
//     blocks: &[String],
//     json_file: &mut std::fs::File,
//     re_tx_id: &Regex, re_tx_type: &Regex, re_tx_from: &Regex, re_tx_dest: &Regex, re_tx_connect: &Regex,
//     re_client_addr: &Regex, re_source_port: &Regex, re_proxy_port: &Regex, re_dest_port: &Regex,
//     re_client_if: &Regex, re_route_dom: &Regex, re_time: &Regex,
//     re_user_name: &Regex, re_realm: &Regex, re_authd: &Regex, re_autzd: &Regex, re_rel_user: &Regex,
//     re_app_name: &Regex, re_app_op: &Regex, re_app_grp: &Regex,
//     re_verdict: &Regex, re_cats_raw: &Regex, re_catgr_raw: &Regex,
//     re_hdr: &Regex, re_match: &Regex,
//     re_timing_total: &Regex, re_checkpoint: &Regex, re_urlcat_ms: &Regex, re_client_bytes: &Regex
// ) -> anyhow::Result<()> {
//     for b in blocks {
//         // policyMatches: agrupar MATCH: bajo el último header visto
//         let mut policy_groups: Vec<serde_json::Value> = Vec::new();
//         let mut current_header: Option<String> = None;
//         let mut current_matches: Vec<String> = Vec::new();

//         for line in b.lines() {
//             if re_hdr.is_match(line) {
//                 if let (Some(h), true) = (&current_header, !current_matches.is_empty()) {
//                     let matches = mem::take(&mut current_matches); // mueve el vec
//                     policy_groups.push(json!({ "header": h, "matches": matches }));
//                 }
//                 current_header = Some(line.trim().to_string());
//             } else if let Some(c) = re_match.captures(line) {
//                 let m = c.get(1).unwrap().as_str().trim().to_string();
//                 if !m.is_empty() { current_matches.push(m); }
//             }
//         }

//         if let (Some(h), true) = (current_header, !current_matches.is_empty()) {
//             let matches = mem::take(&mut current_matches);
//             policy_groups.push(json!({ "header": h, "matches": matches }));
//         }

//         // campos principales
//         let tx_id   = cap_str(re_tx_id, b);
//         let tx_type = cap_str(re_tx_type, b);
//         let tx_from = cap_str(re_tx_from, b);
//         // **NUEVO**: dest = unknown(...) O sino CONNECT(...)
//         let tx_dest = cap_str(re_tx_dest, b).or_else(|| cap_str(re_tx_connect, b));

//         let client   = cap_str(re_client_addr, b);
//         let src_port = cap_str(re_source_port, b).and_then(|v| v.parse::<u32>().ok());

//         let proxy_pt = cap_str(re_proxy_port, b).and_then(|v| v.parse::<u32>().ok());
//         let dest_pt  = cap_str(re_dest_port, b).and_then(|v| v.parse::<u32>().ok());
//         let cli_if   = cap_str(re_client_if, b);
//         let route_dom= cap_str(re_route_dom, b);
//         let time     = cap_str(re_time, b);

//         let user_name= cap_str(re_user_name, b);
//         let realm    = cap_str(re_realm, b);
//         let authd    = cap_str(re_authd, b).map(|s| s.eq_ignore_ascii_case("true"));
//         let autzd    = cap_str(re_autzd, b).map(|s| s.eq_ignore_ascii_case("true"));
//         let rel_user = cap_str(re_rel_user, b);

//         let app_name = cap_str(re_app_name, b);
//         let app_op   = cap_str(re_app_op, b);
//         let app_grp  = cap_str(re_app_grp, b);

//         let verdict  = cap_str(re_verdict, b);
//         let cats     = cap_str(re_cats_raw, b).map(|s| split_semicolons(&s)).unwrap_or_default();
//         let cat_grps = cap_str(re_catgr_raw, b).map(|s| split_semicolons(&s)).unwrap_or_default();

//         // **NUEVO**: timing
//         let total_ms = cap_str(re_timing_total, b).and_then(|v| v.parse::<u64>().ok());

//         // checkpoints esperados (si faltan → null)
//         let mut checkpoints: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
//         let expected = [
//             "new-connection","client-in","server-out","server-in-connection",
//             "server-in","client-out","access-logging","stop-transaction"
//         ];
//         for k in expected { checkpoints.insert(k.to_string(), serde_json::Value::Null); }

//         for cap in re_checkpoint.captures_iter(b) {
//             let name    = cap.get(1).unwrap().as_str().to_string();
//             let start   = cap.get(2).unwrap().as_str().parse::<u64>().ok();
//             let elapsed = cap.get(3).unwrap().as_str().parse::<u64>().ok();
//             checkpoints.insert(name, json!({ "startMs": start, "elapsedMs": elapsed }));
//         }

//         let urlcat_ms = cap_str(re_urlcat_ms, b).and_then(|v| v.parse::<u64>().ok());
//         let (first_byte, last_byte) = match re_client_bytes.captures(b) {
//             Some(c) => (
//                 c.get(1).unwrap().as_str().parse::<u64>().ok(),
//                 c.get(2).unwrap().as_str().parse::<u64>().ok(),
//             ),
//             None => (None, None),
//         };

//         // objeto JSON (similar al PS)
//         let obj = json!({
//             "transaction": {
//                 "id":   tx_id,
//                 "type": tx_type,
//                 "from": tx_from,
//                 "dest": tx_dest
//             },
//             "connection": {
//                 "client":          client,
//                 "sourcePort":      src_port,
//                 "proxyPort":       proxy_pt,
//                 "destPort":        dest_pt,
//                 "clientInterface": cli_if,
//                 "routingDomain":   route_dom,
//                 "time":            time
//             },
//             "user": {
//                 "name":           user_name,
//                 "realm":          realm,
//                 "authenticated":  authd,
//                 "authorized":     autzd,
//                 "relativeName":   rel_user
//             },
//             "application": {
//                 "name":      app_name,
//                 "group":     app_grp,
//                 "operation": app_op
//             },
//             "decision": {
//                 "verdict":        verdict,
//                 "categories":     cats,
//                 "categoryGroups": cat_grps
//             },
//             "policyMatches": policy_groups,
//             "timing": {
//                 "totalTransactionTimeMs":  total_ms,
//                 "checkpoints":             checkpoints,
//                 "urlCategorizationCompleteMs": urlcat_ms,
//                 "clientFirstResponseByteMs":   first_byte,
//                 "clientLastResponseByteMs":    last_byte,
//                 // placeholders para futuras métricas (quedan null)
//                 "sslServerHelloCompleteMs":    serde_json::Value::Null,
//                 "sslServerStartedTunnelMs":    serde_json::Value::Null,
//                 "serverConnectionStartMs":     serde_json::Value::Null,
//                 "serverDnsLookupStartMs":      serde_json::Value::Null,
//                 "serverConnectionConnectedMs": serde_json::Value::Null,
//                 "totalTimeAddedMs":            serde_json::Value::Null,
//                 "totalLatencyToFirstByteMs":   serde_json::Value::Null,
//                 "requestLatencyMs":            serde_json::Value::Null,
//                 "ocsConnectTimeMs":            serde_json::Value::Null,
//                 "responseLatencyFirstByteMs":  serde_json::Value::Null
//             }
//         });

//         // JSON Lines (1 objeto por línea)
//         let line = serde_json::to_string(&obj)?;
//         json_file.write_all(line.as_bytes())?;
//         json_file.write_all(b"\n")?;
//         // (opcional) flush al final del ciclo grande, no por línea
//     }

//     Ok(())
// }
