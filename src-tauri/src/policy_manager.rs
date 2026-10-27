//! Policy settings, immutable inspection snapshots and supervised distribution.
use crate::{
    policy_model::{self, Health},
    policy_remote::{self, Central},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, State};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InspectionUpdate {
    pub id: String,
    pub status: String,
    pub message: String,
}
const VAULT: &str = "com.apheiros.proxytools/central-policy";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Settings {
    pub central_enabled: bool,
    pub direct_enabled: bool,
    pub central: Central,
    pub has_password: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            central_enabled: false,
            direct_enabled: true,
            central: Central::default(),
            has_password: false,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    pub id: String,
    pub name: String,
    pub address: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Inspection {
    pub target: Target,
    pub fingerprint: Option<String>,
    pub health: Option<Health>,
    pub error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Census {
    pub id: String,
    pub mocked: bool,
    pub inspected_at: String,
    pub rows: Vec<Inspection>,
    pub majority: Option<String>,
}
#[derive(Clone)]
struct Snapshot {
    census: Census,
    documents: HashMap<String, String>,
}
#[derive(Clone)]
struct FileSnapshot {
    mocked: bool,
    config: Central,
    original: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    pub id: String,
    pub running: bool,
    pub mocked: bool,
    pub rows: Vec<Step>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Step {
    pub id: String,
    pub name: String,
    pub status: String,
    pub message: String,
}
#[derive(Default)]
struct Inner {
    scans: Vec<Snapshot>,
    files: HashMap<String, FileSnapshot>,
    job: Option<Progress>,
}
#[derive(Default, Clone)]
pub(crate) struct PolicyState(Arc<Mutex<Inner>>);
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::check_cache_dir(app).map_err(|_| "Application cache is unavailable.".into())
}
fn read_settings(root: &Path, mocked: bool) -> Result<Settings, String> {
    let path = root.join(if mocked {
        "policy-settings-mock.json"
    } else {
        "policy-settings.json"
    });
    if !path.exists() {
        return Ok(Settings::default());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|_| "Cannot read policy settings.")?)
        .map_err(|_| "Invalid policy settings file.".into())
}
#[tauri::command]
pub(crate) fn get_policy_settings(app: AppHandle, mocked: bool) -> Result<Settings, String> {
    let mut settings = read_settings(&root(&app)?, mocked)?;
    settings.has_password = !mocked && crate::credential_vault::read(VAULT)?.is_some();
    Ok(settings)
}
#[tauri::command]
pub(crate) fn save_policy_settings(
    app: AppHandle,
    mocked: bool,
    mut settings: Settings,
    password: Option<String>,
    delete_password: bool,
) -> Result<(), String> {
    let root = root(&app)?;
    if settings.central_enabled {
        settings.central.validate()?;
    }
    if let Some(password) = password {
        if mocked {
            return Err("Mock credentials belong in the separate localStorage profile.".into());
        }
        if !password.is_empty() {
            crate::credential_vault::write(
                VAULT,
                password.into_bytes(),
                &settings.central.username,
            )?;
        }
    }
    if delete_password && !mocked {
        crate::credential_vault::delete(VAULT)?;
    }
    settings.has_password = false;
    std::fs::write(
        root.join(if mocked {
            "policy-settings-mock.json"
        } else {
            "policy-settings.json"
        }),
        serde_json::to_vec_pretty(&settings).map_err(|_| "Cannot serialize settings.")?,
    )
    .map_err(|_| "Could not save policy settings.".into())
}
fn central_password(mocked: bool, password: Option<String>) -> Result<String, String> {
    let value = if mocked {
        password.ok_or("Save the Mock central SSH credentials in Settings.")?
    } else {
        String::from_utf8(
            crate::credential_vault::read(VAULT)?
                .ok_or("Save the central SSH password in Settings.")?,
        )
        .map_err(|_| "Invalid saved credential.")?
    };
    if value.is_empty() {
        return Err("Central SSH password is empty.".into());
    }
    Ok(value)
}
fn direct_settings(root: &Path, mocked: bool) -> Result<(), String> {
    if !read_settings(root, mocked)?.direct_enabled {
        return Err("Direct policy distribution is disabled in Settings.".into());
    }
    Ok(())
}
fn snapshot(state: &PolicyState, id: &str, mocked: bool) -> Result<Snapshot, String> {
    state
        .0
        .lock()
        .map_err(|_| "Policy state unavailable.")?
        .scans
        .iter()
        .find(|s| s.census.id == id && s.census.mocked == mocked)
        .cloned()
        .ok_or(
            "Inspection expired or belongs to another data profile. Inspect all proxies again."
                .into(),
        )
}
fn majority(rows: &[Inspection]) -> Option<String> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for row in rows {
        if row.health.as_ref().is_some_and(|h| h.healthy) {
            if let Some(hash) = &row.fingerprint {
                *counts.entry(hash).or_default() += 1;
            }
        }
    }
    counts
        .into_iter()
        .find(|(_, n)| *n > rows.len() / 2)
        .map(|(hash, _)| hash.into())
}
#[tauri::command]
pub(crate) async fn inspect_policies(
    app: AppHandle,
    state: State<'_, PolicyState>,
    mocked: bool,
    targets: Vec<Target>,
    username: String,
    password: String,
    on_progress: tauri::ipc::Channel<InspectionUpdate>,
) -> Result<Census, String> {
    let root = root(&app)?;
    direct_settings(&root, mocked)?;
    if targets.is_empty()
        || targets.len() > 256
        || targets.iter().any(|t| t.id.is_empty())
        || targets.iter().map(|t| &t.id).collect::<HashSet<_>>().len() != targets.len()
    {
        return Err("Inspect 1–256 distinct configured proxies.".into());
    }
    let mut documents = HashMap::new();
    let mut rows = Vec::new();
    let mut bytes = 0;
    // Four concurrent connections per inspection; every configured target gets a result.
    let semaphore = Arc::new(tokio::sync::Semaphore::new(4));
    let mut tasks = tokio::task::JoinSet::new();
    for target in targets {
        let root = root.clone();
        let user = username.clone();
        let pass = password.clone();
        let sem = semaphore.clone();
        let progress = on_progress.clone();
        tasks.spawn(async move {
            let _permit = sem.acquire().await.map_err(|_| "Inspection cancelled.")?;
            let stage = Mutex::new(String::from("Starting SSH"));
            let report = |message: &str| {
                if let Ok(mut current) = stage.lock() {
                    *current = message.to_owned();
                }
                let _ = progress.send(InspectionUpdate {
                    id: target.id.clone(), status: "running".into(), message: message.into(),
                });
            };
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(240),
                policy_remote::appliance_with_progress(
                    &root, &target.address, mocked, &user, &pass, None, None, report,
                ),
            ).await.unwrap_or_else(|_| {
                let current = stage.lock().map(|s| s.clone()).unwrap_or_default();
                Err(format!("Inspection timed out after 240 seconds. Last step: {current}"))
            });
            Ok::<_, String>((target, result))
        });
    }
    while let Some(result) = tasks.join_next().await {
        let (target, result) = result.map_err(|_| "Inspection worker failed.")??;
        let row = match result {
            Ok(text) => {
                bytes += text.len();
                if bytes > 32 * 1024 * 1024 {
                    return Err("Inspection exceeds the 32 MiB snapshot budget; no distribution was started.".into());
                }
                let row = Inspection {
                    target: target.clone(),
                    fingerprint: Some(policy_model::hash(&policy_model::canonical(&text))),
                    health: Some(policy_model::health(&text)),
                    error: None,
                };
                documents.insert(target.id.clone(), text);
                row
            }
            Err(error) => Inspection {
                target,
                fingerprint: None,
                health: None,
                error: Some(error),
            },
        };
        {
            let message = row.error.clone().unwrap_or_else(|| {
                if row.health.as_ref().is_some_and(|health| health.healthy) {
                    "Policy received and structural checks completed.".into()
                } else {
                    format!("Policy received; review required: {}", row.health.as_ref()
                        .map(|health| health.issues.join("; ")).unwrap_or_default())
                }
            });
            let _ = on_progress.send(InspectionUpdate {
                id: row.target.id.clone(),
                status: if row.error.is_some() { "failed" } else { "complete" }.into(),
                message,
            });
        }
        rows.push(row);
    }
    rows.sort_by(|a, b| a.target.name.cmp(&b.target.name));
    let census = Census {
        id: crate::backup_store::new_id("policy"),
        mocked,
        inspected_at: chrono::Utc::now().to_rfc3339(),
        majority: majority(&rows),
        rows,
    };
    let mut inner = state.0.lock().map_err(|_| "Policy state unavailable.")?;
    inner.scans.push(Snapshot {
        census: census.clone(),
        documents,
    });
    if inner.scans.len() > 2 {
        inner.scans.remove(0);
    }
    Ok(census)
}
#[tauri::command]
pub(crate) fn read_policy_snapshot(
    state: State<'_, PolicyState>,
    scan_id: String,
    target_id: String,
    mocked: bool,
) -> Result<String, String> {
    snapshot(&state, &scan_id, mocked)?
        .documents
        .remove(&target_id)
        .ok_or("This proxy has no captured source.".into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDocument {
    pub id: String,
    pub content: String,
    pub health: Health,
}
fn document_cpl(config: &Central, raw: &str) -> Result<String, String> {
    if config.format == "cpl" {
        return Ok(raw.to_owned());
    }
    let value: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|_| "Shared document is not valid JSON.")?;
    if value.get("format").and_then(|v| v.as_str()) != Some("proxytools-policy")
        || value.get("version").and_then(|v| v.as_u64()) != Some(1)
    {
        return Err("Unsupported shared policy format or version.".into());
    }
    value
        .get("cpl")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or("Shared document does not contain CPL.".into())
}
fn replace_document(config: &Central, original: &str, cpl: &str) -> Result<String, String> {
    if config.format == "cpl" {
        return Ok(cpl.to_owned());
    }
    if document_cpl(config, original)? == cpl {
        return Ok(original.to_owned());
    }
    let mut value: serde_json::Value =
        serde_json::from_str(original.trim_start_matches('\u{feff}'))
            .map_err(|_| "Invalid shared document.")?;
    value["cpl"] = serde_json::Value::String(cpl.into());
    let result =
        serde_json::to_string_pretty(&value).map_err(|_| "Cannot encode shared document.")? + "\n";
    if result.len() > policy_model::LIMIT {
        return Err("Encoded shared document exceeds 4 MiB.".into());
    }
    Ok(result)
}
#[tauri::command]
pub(crate) async fn read_central_policy(
    app: AppHandle,
    state: State<'_, PolicyState>,
    mocked: bool,
    mock_password: Option<String>,
) -> Result<FileDocument, String> {
    let root = root(&app)?;
    let settings = read_settings(&root, mocked)?;
    if !settings.central_enabled {
        return Err("Central policy editing is disabled.".into());
    }
    let password = if settings.central.transport == "https" {
        String::new()
    } else {
        central_password(mocked, mock_password)?
    };
    let raw =
        policy_remote::central(&root, &settings.central, mocked, &password, None, None).await?;
    let content = document_cpl(&settings.central, &raw)?;
    let id = crate::backup_store::new_id("policy");
    let health = policy_model::health(&content);
    let mut inner = state.0.lock().map_err(|_| "Policy state unavailable.")?;
    if inner.files.len() >= 4 {
        inner.files.clear();
    }
    inner.files.insert(
        id.clone(),
        FileSnapshot {
            mocked,
            config: settings.central,
            original: raw,
        },
    );
    Ok(FileDocument {
        id,
        content,
        health,
    })
}
#[tauri::command]
pub(crate) async fn save_central_policy(
    app: AppHandle,
    state: State<'_, PolicyState>,
    mocked: bool,
    document_id: String,
    draft: String,
    mock_password: Option<String>,
) -> Result<FileDocument, String> {
    let root = root(&app)?;
    let settings = read_settings(&root, mocked)?;
    if !settings.central_enabled {
        return Err("Central editing is disabled.".into());
    }
    let saved = state
        .0
        .lock()
        .map_err(|_| "Policy state unavailable.")?
        .files
        .get(&document_id)
        .filter(|f| f.mocked == mocked)
        .cloned()
        .ok_or("Document expired. Reload the file.")?;
    if serde_json::to_string(&saved.config).ok() != serde_json::to_string(&settings.central).ok() {
        return Err("Central settings changed. Reload the file.".into());
    }
    let original_cpl = document_cpl(&saved.config, &saved.original)?;
    if !policy_model::health(&original_cpl).healthy {
        return Err("Source format requires manual review. Automatic save is disabled.".into());
    }
    if saved.config.transport == "https" {
        return Err(
            "Web sources are read-only. Export and upload through the hosting service.".into(),
        );
    }
    let content = policy_model::edit(&original_cpl, &draft)?;
    let encoded = replace_document(&saved.config, &saved.original, &content)?;
    let password = central_password(mocked, mock_password)?;
    let raw = policy_remote::central(
        &root,
        &settings.central,
        mocked,
        &password,
        Some(&saved.original),
        Some(&encoded),
    )
    .await?;
    let content = document_cpl(&saved.config, &raw)?;
    let health = policy_model::health(&content);
    state
        .0
        .lock()
        .map_err(|_| "Policy state unavailable.")?
        .files
        .insert(
            document_id.clone(),
            FileSnapshot {
                mocked,
                config: saved.config,
                original: raw,
            },
        );
    Ok(FileDocument {
        id: document_id,
        content,
        health,
    })
}
#[tauri::command]
pub(crate) async fn compare_policy_text(
    old: String,
    new: String,
) -> Result<Vec<policy_model::DiffLine>, String> {
    if old.len() > policy_model::LIMIT || new.len() > policy_model::LIMIT {
        return Err("Diff exceeds the document limit.".into());
    }
    tokio::task::spawn_blocking(move || policy_model::diff(&old, &new))
        .await
        .map_err(|_| "Policy comparison worker failed.".into())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Deploy {
    pub scan_id: String,
    pub source_id: String,
    pub target_ids: Vec<String>,
    pub draft: String,
    pub mocked: bool,
    pub username: String,
    pub password: String,
    pub force_source: bool,
    pub repair: bool,
    #[serde(default)]
    pub shared_document_id: Option<String>,
    #[serde(default)]
    pub mock_shared_password: Option<String>,
}
fn step(state: &PolicyState, id: &str, status: &str, message: &str) {
    if let Ok(mut inner) = state.0.lock() {
        if let Some(job) = inner.job.as_mut() {
            if let Some(row) = job.rows.iter_mut().find(|r| r.id == id) {
                row.status = status.into();
                row.message = message.into();
            }
        }
    }
}
#[tauri::command]
pub(crate) fn get_policy_progress(state: State<'_, PolicyState>, mocked: bool) -> Option<Progress> {
    state
        .0
        .lock()
        .ok()?
        .job
        .as_ref()
        .filter(|j| j.mocked == mocked)
        .cloned()
}
fn deployment_plan(
    saved: &Snapshot,
    request: &Deploy,
) -> Result<(String, Vec<Inspection>), String> {
    let original = saved
        .documents
        .get(&request.source_id)
        .ok_or("Select a readable source proxy.")?;
    if !policy_model::health(original).healthy {
        return Err("The source CPL is not structurally readable.".into());
    }
    let source = saved
        .census
        .rows
        .iter()
        .find(|r| r.target.id == request.source_id)
        .ok_or("Missing source.")?;
    if !request.force_source
        && (saved.census.majority.is_none() || source.fingerprint != saved.census.majority)
    {
        return Err("Select a majority source or explicitly override the reference source.".into());
    }
    let content = policy_model::edit(original, &request.draft)?;
    let ids: HashSet<_> = request.target_ids.iter().collect();
    if ids.is_empty() || ids.len() != request.target_ids.len() {
        return Err("Select at least one eligible destination.".into());
    }
    let rows: Vec<_> = saved
        .census
        .rows
        .iter()
        .filter(|r| ids.contains(&r.target.id))
        .cloned()
        .collect();
    if rows.len() != ids.len()
        || rows
            .iter()
            .any(|r| !r.health.as_ref().is_some_and(|h| h.healthy))
    {
        return Err("Every destination must have a readable, healthy policy snapshot.".into());
    }
    if request.repair {
        if rows.len() != 1 {
            return Err("Manual discrepancy repair must target exactly one proxy.".into());
        }
    } else if rows.iter().any(|r| r.fingerprint != saved.census.majority)
        || saved.census.majority.is_none()
    {
        return Err("Only healthy majority proxies can be bulk destinations. Resolve discrepancies individually, then rescan.".into());
    }
    Ok((content, rows))
}
async fn verify_shared_source(
    root: &Path,
    saved: &FileSnapshot,
    password: &str,
) -> Result<(), String> {
    let settings = read_settings(root, saved.mocked)?;
    if !settings.central_enabled
        || serde_json::to_string(&settings.central).ok()
            != serde_json::to_string(&saved.config).ok()
    {
        return Err(
            "Shared source settings changed. Reload the policy before distributing.".into(),
        );
    }
    let raw =
        policy_remote::central(root, &saved.config, saved.mocked, password, None, None).await?;
    if raw != saved.original {
        return Err(
            "Shared source changed since it was loaded. Reload and compare before distributing."
                .into(),
        );
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn distribute_policy(
    app: AppHandle,
    state: State<'_, PolicyState>,
    request: Deploy,
) -> Result<Progress, String> {
    let root = root(&app)?;
    direct_settings(&root, request.mocked)?;
    let saved = snapshot(&state, &request.scan_id, request.mocked)?;
    let (content, rows) = deployment_plan(&saved, &request)?;
    let shared = if let Some(id) = request.shared_document_id.as_ref() {
        let file = state
            .0
            .lock()
            .map_err(|_| "Policy state unavailable.")?
            .files
            .get(id)
            .filter(|file| file.mocked == request.mocked)
            .cloned()
            .ok_or("Shared snapshot expired. Reload the shared source.")?;
        let password = if file.config.transport == "https" {
            String::new()
        } else {
            central_password(request.mocked, request.mock_shared_password.clone())?
        };
        verify_shared_source(&root, &file, &password).await?;
        Some((file, password))
    } else {
        None
    };

    let progress = Progress {
        id: crate::backup_store::new_id("policy"),
        running: true,
        mocked: request.mocked,
        rows: rows
            .iter()
            .map(|r| Step {
                id: r.target.id.clone(),
                name: r.target.name.clone(),
                status: "pending".into(),
                message: "Waiting for all-proxy preflight.".into(),
            })
            .collect(),
    };
    {
        let mut inner = state.0.lock().map_err(|_| "Policy state unavailable.")?;
        if inner.job.as_ref().is_some_and(|j| j.running) {
            return Err("A policy distribution is already running.".into());
        }
        inner.job = Some(progress.clone());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move {
        // Revalidate the complete census, including the reference and excluded proxies.
        let mut current = Vec::new();
        for old in &saved.census.rows {
            for row in &rows {
                step(
                    &state,
                    &row.target.id,
                    "pending",
                    &format!("All-proxy preflight: checking {}.", old.target.name),
                );
            }
            let result = policy_remote::appliance(
                &root,
                &old.target.address,
                request.mocked,
                &request.username,
                &request.password,
                None,
                None,
            )
            .await;
            current.push(match result {
                Ok(text) => Inspection {
                    target: old.target.clone(),
                    fingerprint: Some(policy_model::hash(&policy_model::canonical(&text))),
                    health: Some(policy_model::health(&text)),
                    error: None,
                },
                Err(error) => Inspection {
                    target: old.target.clone(),
                    fingerprint: None,
                    health: None,
                    error: Some(error),
                },
            });
        }
        let changed = current.iter().any(|now| {
            saved
                .census
                .rows
                .iter()
                .find(|r| r.target.id == now.target.id)
                .is_none_or(|old| old.fingerprint != now.fingerprint)
        }) || majority(&current) != saved.census.majority;
        if changed {
            for row in &rows {
                step(&state,&row.target.id,"conflict","Inspection changed during preflight. Nothing was applied; inspect all proxies again.");
            }
        } else {
            for row in &rows {
                if let Some((file, password)) = shared.as_ref() {
                    if let Err(error) = verify_shared_source(&root, file, password).await {
                        step(&state, &row.target.id, "conflict", &error);
                        continue;
                    }
                }
                if direct_settings(&root, request.mocked).is_err() {
                    step(
                        &state,
                        &row.target.id,
                        "failed",
                        "Direct distribution was disabled; proxy was not modified.",
                    );
                    continue;
                }
                step(&state,&row.target.id,"running","Recheck source → enable → config terminal → inline policy local → compile → readback.");
                let result = policy_remote::appliance(
                    &root,
                    &row.target.address,
                    request.mocked,
                    &request.username,
                    &request.password,
                    row.fingerprint.as_deref(),
                    Some(&content),
                )
                .await;
                match result {
                    Ok(_) => step(
                        &state,
                        &row.target.id,
                        "success",
                        "Compiler accepted CPL and readback matches.",
                    ),
                    Err(error) => step(&state, &row.target.id, "failed", &error),
                }
            }
        }
        if let Ok(mut inner) = state.0.lock() {
            if let Some(job) = inner.job.as_mut() {
                job.running = false;
            }
        }
    });
    Ok(progress)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: &str, fingerprint: Option<&str>) -> Inspection {
        Inspection {
            target: Target {
                id: id.into(),
                name: id.into(),
                address: id.into(),
            },
            fingerprint: fingerprint.map(str::to_owned),
            health: Some(policy_model::health("<Proxy>\nallow")),
            error: None,
        }
    }
    #[test]
    fn majority_requires_more_than_half_of_all_configured_proxies() {
        assert_eq!(
            majority(&[
                row("a", Some("x")),
                row("b", Some("x")),
                row("c", Some("y"))
            ]),
            Some("x".into())
        );
        assert!(majority(&[row("a", Some("x")), row("b", Some("y"))]).is_none());
        assert!(majority(&[row("a", Some("x")), row("b", None)]).is_none());
    }
    #[test]
    fn settings_are_independent_and_central_is_opt_in() {
        let s = Settings::default();
        assert!(!s.central_enabled);
        assert!(s.direct_enabled);
        assert!(s.central.validate().is_err());
    }
}

impl PolicyState {
    pub(crate) fn running(&self) -> bool {
        self.0
            .lock()
            .map(|inner| inner.job.as_ref().is_some_and(|job| job.running))
            .unwrap_or(true)
    }
}

#[cfg(test)]
mod distribution_tests {
    use super::*;
    #[test]
    fn shared_document_preserves_cpl_and_unknown_metadata() {
        let config = Central {
            format: "project".into(),
            ..Default::default()
        };
        let raw = "{\"format\":\"proxytools-policy\",\"version\":1,\"cpl\":\"<Proxy>\\r\\nallow\\r\\n\",\"team\":{\"owner\":\"test\"}}";
        let cpl = document_cpl(&config, raw).unwrap();
        assert_eq!(cpl, "<Proxy>\r\nallow\r\n");
        assert_eq!(replace_document(&config, raw, &cpl).unwrap(), raw);
        let edited = replace_document(&config, raw, "<Proxy>\ndeny\n").unwrap();
        let value: serde_json::Value = serde_json::from_str(&edited).unwrap();
        assert_eq!(value["team"]["owner"], "test");
        assert_eq!(document_cpl(&config, &edited).unwrap(), "<Proxy>\ndeny\n");
        assert!(document_cpl(
            &config,
            "{\"format\":\"other\",\"version\":1,\"cpl\":\"allow\"}"
        )
        .is_err());
    }
    #[test]
    fn old_settings_default_to_plain_cpl_and_web_sources_require_https() {
        let config: Central = serde_json::from_str("{\"host\":\"files.example\",\"port\":22,\"path\":\"/srv/local.cpl\",\"username\":\"test\",\"shell\":\"posix\"}").unwrap();
        assert_eq!(config.format, "cpl");
        assert_eq!(config.transport, "ssh");
        let mut web = Central {
            transport: "https".into(),
            url: "https://files.example/policy.json".into(),
            format: "project".into(),
            ..Default::default()
        };
        assert!(web.validate().is_ok());
        web.url = "http://files.example/policy.json".into();
        assert!(web.validate().is_err());
        web.url = "https://user:secret@files.example/policy.json".into();
        assert!(web.validate().is_err());
    }

    fn fixture() -> (Snapshot, Deploy) {
        let documents: HashMap<String, String> = [
            ("a", "<Proxy>\nallow\n"),
            ("b", "<Proxy>\nallow\n"),
            ("c", "<Proxy>\ndeny\n"),
        ]
        .into_iter()
        .map(|(id, text)| (id.into(), text.into()))
        .collect();
        let rows: Vec<_> = documents
            .iter()
            .map(|(id, text)| Inspection {
                target: Target {
                    id: id.clone(),
                    name: id.clone(),
                    address: id.clone(),
                },
                fingerprint: Some(policy_model::hash(&policy_model::canonical(text))),
                health: Some(policy_model::health(text)),
                error: None,
            })
            .collect();
        let census = Census {
            id: "scan".into(),
            mocked: true,
            inspected_at: String::new(),
            majority: majority(&rows),
            rows,
        };
        let saved = Snapshot { census, documents };
        let request = Deploy {
            scan_id: "scan".into(),
            source_id: "a".into(),
            target_ids: vec!["a".into(), "b".into()],
            draft: "<Proxy>\nurl.domain=x deny\n".into(),
            mocked: true,
            username: "fixture".into(),
            password: "fixture-only".into(),
            force_source: false,
            repair: false,
            shared_document_id: None,
            mock_shared_password: None,
        };
        (saved, request)
    }
    #[test]
    fn backend_excludes_minority_even_if_client_selects_it() {
        let (snapshot, mut request) = fixture();
        assert_eq!(deployment_plan(&snapshot, &request).unwrap().1.len(), 2);
        request.target_ids.push("c".into());
        assert!(deployment_plan(&snapshot, &request).is_err());
        request.force_source = true;
        assert!(deployment_plan(&snapshot, &request).is_err());
        request.repair = true;
        assert!(deployment_plan(&snapshot, &request).is_err());
        request.target_ids = vec!["c".into()];
        assert!(deployment_plan(&snapshot, &request).is_ok());
    }
    #[test]
    fn explicit_source_override_does_not_relax_destination_guards() {
        let (snapshot, mut request) = fixture();
        request.source_id = "c".into();
        assert!(deployment_plan(&snapshot, &request).is_err());
        request.force_source = true;
        assert!(deployment_plan(&snapshot, &request).is_ok());
        request.target_ids = vec!["missing".into()];
        assert!(deployment_plan(&snapshot, &request).is_err());
    }
    #[test]
    fn no_majority_requires_individual_confirmation_and_source_override() {
        let (mut snapshot, mut request) = fixture();
        snapshot.census.majority = None;
        request.force_source = true;
        assert!(deployment_plan(&snapshot, &request).is_err());
        request.repair = true;
        request.target_ids = vec!["b".into()];
        assert!(deployment_plan(&snapshot, &request).is_ok());
    }
}
