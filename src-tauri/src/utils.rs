use regex::Regex;
use once_cell::sync::Lazy;
use serde_json::json;
use std::{mem, io::{Write}};
use std::collections::BTreeMap;

static RE_TAGS:          Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)</?[a-z][a-z0-9]*(\s+[^<>]*?)?>").unwrap());
// static RE_BLOCK:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?ms)^start transaction.*?^stop transaction.*?$").unwrap());
static RE_BLOCK:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?is)start(?:\s|<[^>]*>)*transaction\b.*?stop(?:\s|<[^>]*>)*transaction\b").unwrap());
static RE_TX_ID:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)transaction ID=(\d+)").unwrap());
static RE_PARENT_ID:     Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^transaction handed off from:\s*(\d+)").unwrap());
static RE_TX_TYPE:       Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\btype=([^\s]+)").unwrap());
static RE_TX_FROM:       Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)transaction handed off from:\s*([0-9]+)").unwrap());
static RE_TX_DEST:       Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*(?:unknown|get|post)\s+(\S+://\S+)").unwrap());
static RE_TX_CONNECT:    Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*CONNECT\s+(\S+)").unwrap());

static RE_CLIENT_ADDR:   Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bclient\.address=(\d+\.\d+\.\d+\.\d+)").unwrap());
static RE_SOURCE_PORT:   Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bsource\.port=(\d+)").unwrap());
static RE_PROXY_PORT:    Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bproxy\.port=(\d+)").unwrap());
static RE_DEST_PORT:     Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bdest\.port=(\d+)").unwrap());
static RE_CLIENT_IF:     Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bclient\.interface=([^\s]+)").unwrap());
static RE_ROUTE_DOM:     Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\brouting-domain=([^\s]+)").unwrap());
static RE_TIME:          Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*time:\s*([0-9-:\sA-Za-z]+)$").unwrap());

static RE_USER_NAME:     Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?mi)\buser:\s+name\s*=\s*["']([^"']+)["']"#).unwrap());
static RE_REALM:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\brealm=([A-Za-z0-9_/-]+)").unwrap());
static RE_AUTHD:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bauthenticated=(true|false)").unwrap());
static RE_AUTZD:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)\bauthorized=(true|false)").unwrap());
static RE_REL_USER:      Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)relative username='([^']*)'").unwrap());

static RE_APP_NAME:      Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)application\.name:\s*([^\r\n]+)").unwrap());
static RE_APP_OP:        Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)application\.operation:\s*([^\r\n]+)").unwrap());
static RE_APP_GRP:       Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)application\.group:\s*([^\r\n]+)").unwrap());

static RE_VERDICT:       Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*verdict:\s*([^\r\n]+)").unwrap());
static RE_CATS_RAW:      Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*url\.category:\s*([^\r\n]+)").unwrap());
static RE_CATGR_RAW:     Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*category groups:\s*([^\r\n]+)").unwrap());

static RE_HDR:           Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*<\s*(?:(?:proxy|cache)|[A-Za-z][\w.-]*@[A-Za-z0-9._-]+)\s*>\s*(?:\[[^\]]*\]\s*)*$").unwrap());
static RE_MATCH:         Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^\s*MATCH:\s*(.+)$").unwrap());

static RE_COND_NAME:  Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\s*condition\s+("([^"]+)"|[^\s]+)\s*$"#).unwrap());
static RE_ASSIGNED_KV: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?m)^\s*([A-Za-z0-9_.-]+)=(.*)\s*$"#).unwrap());

static RE_TIMING_TOTAL:  Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^Transaction timing:\s*total-transaction-time\s+(\d+)\s*ms").unwrap());
static RE_CHECKPOINT:    Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^\s*([a-z0-9\-]+):\s*start\s+(\d+)\s+elapsed\s+(\d+)\s*ms").unwrap());
static RE_URLCAT_MS:     Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^url_categorization complete time:\s*(\d+)").unwrap());
static RE_CLIENT_BYTES:  Lazy<Regex> = Lazy::new(|| Regex::new(r"(?mi)^client connection:\s*first-response-byte\s+(\d+)\s+last-response-byte\s+(\d+)").unwrap());


pub fn get_regex(name: &str) -> Option<&'static Regex> {
  match name {
    "re_tags"          => Some(&RE_TAGS),
    "re_block"         => Some(&RE_BLOCK),
    "re_tx_id"         => Some(&RE_TX_ID),
    "re_parent_id"       => Some(&RE_PARENT_ID),
    "re_tx_type"       => Some(&RE_TX_TYPE),
    "re_tx_from"       => Some(&RE_TX_FROM),
    "re_tx_dest"       => Some(&RE_TX_DEST),
    "re_tx_connect"    => Some(&RE_TX_CONNECT),

    "re_client_addr"   => Some(&RE_CLIENT_ADDR),
    "re_source_port"   => Some(&RE_SOURCE_PORT),
    "re_proxy_port"    => Some(&RE_PROXY_PORT),
    "re_dest_port"     => Some(&RE_DEST_PORT),
    "re_client_if"     => Some(&RE_CLIENT_IF),
    "re_route_dom"     => Some(&RE_ROUTE_DOM),
    "re_time"          => Some(&RE_TIME),

    "re_user_name"     => Some(&RE_USER_NAME),
    "re_realm"         => Some(&RE_REALM),
    "re_authd"         => Some(&RE_AUTHD),
    "re_autzd"         => Some(&RE_AUTZD),
    "re_rel_user"      => Some(&RE_REL_USER),

    "re_app_name"      => Some(&RE_APP_NAME),
    "re_app_op"        => Some(&RE_APP_OP),
    "re_app_grp"       => Some(&RE_APP_GRP),

    "re_verdict"       => Some(&RE_VERDICT),
    "re_cats_raw"      => Some(&RE_CATS_RAW),
    "re_catgr_raw"     => Some(&RE_CATGR_RAW),

    "re_hdr"           => Some(&RE_HDR),
    "re_match"         => Some(&RE_MATCH),

    "re_cond_name"     => Some(&RE_COND_NAME),
    "re_assigned_kv"   => Some(&RE_ASSIGNED_KV),

    "re_timing_total"  => Some(&RE_TIMING_TOTAL),
    "re_checkpoint"    => Some(&RE_CHECKPOINT),
    "re_urlcat_ms"     => Some(&RE_URLCAT_MS),
    "re_client_bytes"  => Some(&RE_CLIENT_BYTES),

    _ => None,
  }
}


pub fn parse_sections(input: &str) -> (serde_json::Value, serde_json::Value) {
    // -------- Matched condition definitions --------
    let mut matched_conditions = Vec::<serde_json::Value>::new();
    let mut in_cond = false;
    let mut cur_name: Option<String> = None;
    let mut cur_matches: Vec<String> = Vec::new();

    for line in input.lines() {
        if line.trim_start().starts_with("Matched condition definitions:") {
            // cerrar si venía algo residual
            if let (Some(n), true) = (cur_name.take(), !cur_matches.is_empty()) {
                matched_conditions.push(json!({"condition": n, "matches": cur_matches.clone()}));
                cur_matches.clear();
            }
            in_cond = true;
            continue;
        }
        if in_cond {
            if line.trim_start().starts_with("Assigned values of transaction variables:") {
                // fin de sección
                if let (Some(n), true) = (cur_name.take(), !cur_matches.is_empty()) {
                    matched_conditions.push(json!({"condition": n, "matches": cur_matches.clone()}));
                    cur_matches.clear();
                }
                in_cond = false;
                continue;
            }
            if let Some(c) = get_regex("re_cond_name").expect("regex no inicializado").captures(line) { // RE_COND_NAME.captures(line) {
                // volcar el bloque anterior si tenía matches
                if let (Some(n), true) = (cur_name.take(), !cur_matches.is_empty()) {
                    matched_conditions.push(json!({"condition": n, "matches": cur_matches.clone()}));
                    cur_matches.clear();
                }
                let name = c.get(2).map(|m| m.as_str())
                    .or_else(|| c.get(1).map(|m| m.as_str()))
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                cur_name = Some(name);
                continue;
            }
            if let Some(m) = get_regex("re_match").expect("regex no inicializado").captures(line) { // RE_MATCH_LINE.captures(line) {
                cur_matches.push(m[1].trim().to_string());
            }
        }
    }
    // flush final
    if let (Some(n), true) = (cur_name.take(), !cur_matches.is_empty()) {
        matched_conditions.push(json!({"condition": n, "matches": cur_matches}));
    }

    // -------- Assigned values of transaction variables --------
    let mut assigned_vars = BTreeMap::<String, String>::new();
    let mut in_assigned = false;

    for line in input.lines() {
        if line.trim_start().starts_with("Assigned values of transaction variables:") {
            in_assigned = true;
            continue;
        }
        if in_assigned {
            // cortar al encontrar una línea que claramente no es KV
            if line.trim().is_empty()
                || line.trim_start().starts_with("Matched condition definitions:")
                || line.trim_start().starts_with("Called ")
            {
                in_assigned = false;
                continue;
            }
            if let Some(kv) = RE_ASSIGNED_KV.captures(line) {
                let k = kv[1].to_string();
                let v = kv[2].to_string();
                assigned_vars.insert(k, v);
            }
        }
    }

    let matched_conditions_json = json!(matched_conditions);
    let assigned_vars_json = json!(assigned_vars);

    (matched_conditions_json, assigned_vars_json)
}


pub fn cap_str(re: Option<&'static Regex>, s: &str) -> Option<String> {
   match re.expect("regex no inicializado").captures(s).and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string())){
       Some(s) => Some(s),
       None => None
   }
}

pub fn split_semicolons(s: &str) -> Vec<String> {
    s.split(';')
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect()
}



pub fn append_json_for_blocks(
    blocks: &[String],
    json_file: &mut std::fs::File,
) -> anyhow::Result<Vec<String>> {
    let mut json_vec: Vec<String> = Vec::new();
    for b in blocks {
        // policyMatches: agrupar MATCH: bajo el último header visto
        let mut policy_groups: Vec<serde_json::Value> = Vec::new();
        let mut current_header: Option<String> = None;
        let mut current_matches: Vec<String> = Vec::new();

       for line in b.lines() {
            let t = line.trim_start();

            // si empieza otra sección, cerrá y salí del header actual
            if t.starts_with("Matched condition definitions:")
                || t.starts_with("Assigned values of transaction variables:")
                || t.starts_with("Called ")
            {
                if let (Some(h), true) = (&current_header, !current_matches.is_empty()) {
                    let matches = mem::take(&mut current_matches);
                    policy_groups.push(json!({ "header": h, "matches": matches }));
                }
                current_header = None;
                continue;
            }

            if get_regex("re_hdr").expect("regex no inicializado").is_match(line) {
                if let (Some(h), true) = (&current_header, !current_matches.is_empty()) {
                    let matches = mem::take(&mut current_matches);
                    policy_groups.push(json!({ "header": h, "matches": matches }));
                }
                current_header = Some(line.trim().to_string());
                continue;
            }

            if let Some(c) = get_regex("re_match").expect("regex no inicializado").captures(line) {
                // sólo acumular MATCH si hay header abierto
                if current_header.is_some() {
                    let m = c.get(1).unwrap().as_str().trim().to_string();
                    if !m.is_empty() { current_matches.push(m); }
                }
            }
        }

        // flush final
        if let (Some(h), true) = (current_header, !current_matches.is_empty()) {
            let matches = mem::take(&mut current_matches);
            policy_groups.push(json!({ "header": h, "matches": matches }));
        }

        // campos principales
        let tx_id   = cap_str(get_regex("re_tx_id"), b);
        let tx_pid   = cap_str(get_regex("re_parent_id"), b);
        let tx_type = cap_str(get_regex("re_tx_type"), b);
        let tx_from = cap_str(get_regex("re_tx_from"), b);
        // **NUEVO**: dest = unknown(...) O sino CONNECT(...)
        let tx_dest = cap_str(get_regex("re_tx_dest"), b).or_else(|| cap_str(get_regex("re_tx_connect"), b));

        let client   = cap_str(get_regex("re_client_addr"), b);
        let src_port = cap_str(get_regex("re_source_port"), b).and_then(|v| v.parse::<u32>().ok());

        let proxy_pt = cap_str(get_regex("re_proxy_port"), b).and_then(|v| v.parse::<u32>().ok());
        let dest_pt  = cap_str(get_regex("re_dest_port"), b).and_then(|v| v.parse::<u32>().ok());
        let cli_if   = cap_str(get_regex("re_client_if"), b);
        let route_dom= cap_str(get_regex("re_route_dom"), b);
        let time     = cap_str(get_regex("re_time"), b);

        let user_name= cap_str(get_regex("re_user_name"), b);
        let realm    = cap_str(get_regex("re_realm"), b);
        let authd    = cap_str(get_regex("re_authd"), b).map(|s| s.eq_ignore_ascii_case("true"));
        let autzd    = cap_str(get_regex("re_autzd"), b).map(|s| s.eq_ignore_ascii_case("true"));
        let rel_user = cap_str(get_regex("re_rel_user"), b);

        let app_name = cap_str(get_regex("re_app_name"), b);
        let app_op   = cap_str(get_regex("re_app_op"), b);
        let app_grp  = cap_str(get_regex("re_app_grp"), b);

        let verdict  = cap_str(get_regex("re_verdict"), b);
        let cats     = cap_str(get_regex("re_cats_raw"), b).map(|s| split_semicolons(&s)).unwrap_or_default();
        let cat_grps = cap_str(get_regex("re_catgr_raw"), b).map(|s| split_semicolons(&s)).unwrap_or_default();

        // **NUEVO**: timing
        let total_ms = cap_str(get_regex("re_timing_total"), b).and_then(|v| v.parse::<u64>().ok());

        let (matched_conditions_json, assigned_vars_json) = parse_sections(b);

        // checkpoints esperados (si faltan → null)
        let mut checkpoints: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        let expected = [
            "new-connection","client-in","server-out","server-in-connection",
            "server-in","client-out","access-logging","stop-transaction"
        ];
        for k in expected { checkpoints.insert(k.to_string(), serde_json::Value::Null); }

        for cap in get_regex("re_checkpoint").expect("regex no inicializado").captures_iter(b) {
            let name    = cap.get(1).unwrap().as_str().to_string();
            let start   = cap.get(2).unwrap().as_str().parse::<u64>().ok();
            let elapsed = cap.get(3).unwrap().as_str().parse::<u64>().ok();
            checkpoints.insert(name, json!({ "startMs": start, "elapsedMs": elapsed }));
        }

        let urlcat_ms = cap_str(get_regex("re_urlcat_ms"), b).and_then(|v| v.parse::<u64>().ok());
        let (first_byte, last_byte) = match get_regex("re_client_bytes").expect("regex no inicializado").captures(b) {
            Some(c) => (
                c.get(1).unwrap().as_str().parse::<u64>().ok(),
                c.get(2).unwrap().as_str().parse::<u64>().ok(),
            ),
            None => (None, None),
        };

        // objeto JSON (similar al PS)
        let obj = json!({
            "transaction": {
                "id":   tx_id,
                "pid":  tx_pid,
                "type": tx_type,
                "from": tx_from,
                "dest": tx_dest
            },
            "connection": {
                "client":          client,
                "sourcePort":      src_port,
                "proxyPort":       proxy_pt,
                "destPort":        dest_pt,
                "clientInterface": cli_if,
                "routingDomain":   route_dom,
                "time":            time
            },
            "user": {
                "name":           user_name,
                "realm":          realm,
                "authenticated":  authd,
                "authorized":     autzd,
                "relativeName":   rel_user
            },
            "application": {
                "name":      app_name,
                "group":     app_grp,
                "operation": app_op
            },
            "decision": {
                "verdict":        verdict,
                "categories":     cats,
                "categoryGroups": cat_grps
            },
            "policyMatches": policy_groups,
            "matchedConditions": matched_conditions_json,
            "assignedVariables": assigned_vars_json,
            "timing": {
                "totalTransactionTimeMs":  total_ms,
                "checkpoints":             checkpoints,
                "urlCategorizationCompleteMs": urlcat_ms,
                "clientFirstResponseByteMs":   first_byte,
                "clientLastResponseByteMs":    last_byte,
                // placeholders para futuras métricas (quedan null)
                "sslServerHelloCompleteMs":    serde_json::Value::Null,
                "sslServerStartedTunnelMs":    serde_json::Value::Null,
                "serverConnectionStartMs":     serde_json::Value::Null,
                "serverDnsLookupStartMs":      serde_json::Value::Null,
                "serverConnectionConnectedMs": serde_json::Value::Null,
                "totalTimeAddedMs":            serde_json::Value::Null,
                "totalLatencyToFirstByteMs":   serde_json::Value::Null,
                "requestLatencyMs":            serde_json::Value::Null,
                "ocsConnectTimeMs":            serde_json::Value::Null,
                "responseLatencyFirstByteMs":  serde_json::Value::Null
            }
        });

        // JSON Lines (1 objeto por línea)
        let line = serde_json::to_string(&obj)?;
        json_file.write_all(line.as_bytes())?;
        json_file.write_all(b"\n")?;
        json_vec.push(line);
        // (opcional) flush al final del ciclo grande, no por línea
    }

    Ok(json_vec)
}