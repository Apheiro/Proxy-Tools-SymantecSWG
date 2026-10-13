use crate::backup_store::{self, BackupMode, BackupRecord};
use crate::ssh_client::{
    command_failed, Cli, PromptPolicy, Response, SshConnection, SshEvent, SshOptions,
};
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(1800);
const SHOW: &str = "show configuration expanded noprompts";

fn ssh_port(mocked: bool) -> u16 {
    if mocked {
        2222
    } else {
        22
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub running: bool,
    pub id: String,
    pub destination: String,
    pub phase: String,
    pub actions: Vec<String>,
    pub bytes: u64,
    pub error: Option<String>,
    pub warning: Option<String>,
}

#[derive(Default)]
pub struct BackupState(Mutex<BackupStatus>);

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window
            .state::<BackupState>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .running
        {
            api.prevent_close();
            let _ = window.emit("backup:close-blocked", "Wait for the backup and private-key cleanup to finish before closing the application.");
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    appliance: String,
    address: String,
    username: String,
    password: String,
    mode: BackupMode,
    mocked: bool,
}

fn destination(request: &BackupRequest) -> Result<String, String> {
    if request.mocked {
        return Ok("127.0.0.1".into());
    }
    let value = request.address.trim();
    if value.is_empty() || value.contains(['/', '\\', '@', '\n', '\r', ' ']) {
        return Err("Invalid appliance SSH address.".into());
    }
    Ok(value.to_owned())
}

fn update(app: &AppHandle, phase: &str, action: Option<&str>, bytes: Option<u64>) {
    let state = app.state::<BackupState>();
    let mut status = state.0.lock().unwrap_or_else(|e| e.into_inner());
    status.phase = phase.into();
    if let Some(action) = action {
        status.actions.push(action.into());
    }
    if let Some(bytes) = bytes {
        status.bytes = bytes;
    }
    let _ = app.emit("backup:status", status.clone());
}

#[tauri::command]
pub fn get_backup_status(state: State<'_, BackupState>) -> BackupStatus {
    state.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command]
pub async fn list_backups(app: AppHandle) -> Result<Vec<BackupRecord>, String> {
    let root = crate::check_cache_dir(&app).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || backup_store::list(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_backup(app: AppHandle, id: String) -> Result<String, String> {
    let root = crate::check_cache_dir(&app).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || backup_store::read(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_backup(
    app: AppHandle,
    state: State<'_, BackupState>,
    id: String,
) -> Result<(), String> {
    {
        let status = state.0.lock().map_err(|_| "Backup state is unavailable.")?;
        if status.running && status.id == id {
            return Err("This backup is still running. Wait for it to finish.".into());
        }
    }
    let root = crate::check_cache_dir(&app).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || backup_store::delete(&root, &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_backup_folder(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = crate::check_cache_dir(&app).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        app.opener()
            .open_path(root.to_string_lossy(), None::<&str>)
            .map_err(|e| format!("Could not open the backup folder: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn start_backup(
    app: AppHandle,
    state: State<'_, BackupState>,
    request: BackupRequest,
) -> Result<String, String> {
    let host = destination(&request)?;
    let port = ssh_port(request.mocked);
    if request.username.trim().is_empty()
        || request.password.is_empty()
        || request.password.contains(['\n', '\r'])
    {
        return Err(
            "Saved SSH credentials are missing or invalid. Configure credentials in Settings."
                .into(),
        );
    }
    let root = crate::check_cache_dir(&app).map_err(|e| e.to_string())?;
    let id = backup_store::new_id(&request.appliance);
    {
        let mut status = state.0.lock().map_err(|_| "Backup state is unavailable.")?;
        if status.running {
            return Err("A backup is already running. Wait for its cleanup to finish.".into());
        }
        *status = BackupStatus {
            running: true,
            id: id.clone(),
            destination: format!("{host}:{port}"),
            phase: "Connecting".into(),
            actions: vec![format!("Connect SSH to {host}:{port}")],
            ..Default::default()
        };
    }
    // Navigation must not cancel the task and bypass private-key-display cleanup.
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = run_backup(&task_app, &root, &host, request).await;
        let state = task_app.state::<BackupState>();
        let mut status = state.0.lock().unwrap_or_else(|e| e.into_inner());
        status.running = false;
        match result {
            Ok(record) => {
                status.phase = "Completed".into();
                status.warning = record.warning;
            }
            Err(error) => {
                status.phase = "Failed".into();
                status.error = Some(error);
            }
        }
        let _ = task_app.emit("backup:status", status.clone());
    });
    Ok(id)
}

fn ssh_progress(app: Option<&AppHandle>, event: SshEvent) {
    let Some(app) = app else {
        return;
    };
    match event {
        SshEvent::Authentication(action) => update(app, "Authenticating", Some(&action), None),
        SshEvent::Command(command) => update(app, "Executing command", Some(&command), None),
        SshEvent::OutputBytes(bytes) => update(app, "Capturing configuration", None, Some(bytes)),
    }
}

fn sgos_prompt_policy() -> PromptPolicy {
    PromptPolicy::new(
        r"^([A-Za-z0-9_. /:-]{1,120})([>#])(?:\(config\))?$",
        &[">", "#", "#(config)"],
    )
    .expect("Valid SGOS prompt policy")
}

async fn restore_private_keys(cli: &mut Cli, app: Option<&AppHandle>) -> Result<(), String> {
    let report = |event| ssh_progress(app, event);
    if let Some(app) = app {
        update(app, "Restoring private-key display", None, None);
    }
    if !cli.at_prompt() {
        cli.interrupt().await?;
    }
    if !cli.current_prompt().ends_with("#(config)") {
        cli.command(Some(&report), "config terminal").await?;
    }
    cli.command(Some(&report), "security private-key-display none")
        .await?;
    if !cli.current_prompt().ends_with("#(config)") {
        return Err("Could not confirm configuration mode during cleanup.".into());
    }
    cli.command(Some(&report), "exit").await
}

async fn capture_configuration(
    cli: &mut Cli,
    password: &str,
    mode: BackupMode,
    partial: &std::path::Path,
    app: Option<&AppHandle>,
) -> Result<(u64, Option<String>), String> {
    let report = |event| ssh_progress(app, event);
    cli.receive(None, false, COMMAND_TIMEOUT, None).await?;
    if let Some(app) = app {
        update(app, "Elevating privileges", Some("enable"), None);
    }
    cli.send("enable").await?;
    let (response, _, _) = cli.receive(None, true, COMMAND_TIMEOUT, None).await?;
    let value = match response {
        Response::Password => {
            if let Some(app) = app {
                update(
                    app,
                    "Elevating privileges",
                    Some("Answer enable password challenge with saved password"),
                    None,
                );
            }
            cli.send(password).await?;
            let (response, _, _) = cli.receive(None, false, COMMAND_TIMEOUT, None).await?;
            match response {
                Response::Prompt(value) => {
                    if value != format!("{}#", cli.prompt_base()) {
                        return Err("Enable rejected the saved password. The CLI enable password must match the stored SSH password; check EnablePassword in dummy.ps1 when using Mocked Data.".into());
                    }
                    value
                }
                _ => return Err("Unexpected enable challenge.".into()),
            }
        }
        Response::Prompt(value) => value,
    };
    if value != format!("{}#", cli.prompt_base()) {
        return Err("Enable returned a non-privileged prompt without requesting a password. Check the CLI interaction; no enable password was sent.".into());
    }
    let mut keys_may_be_visible = false;
    let capture: Result<u64, String> = async {
        if mode == BackupMode::Unencrypted {
            cli.command(Some(&report), "config terminal").await?;
            if !cli.current_prompt().ends_with("#(config)") {
                return Err("Appliance did not enter configuration mode.".into());
            }
            keys_may_be_visible = true;
            cli.command(Some(&report), "security private-key-display unencrypted")
                .await?;
            cli.command(Some(&report), "exit").await?;
        }
        let mut options = tokio::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options
            .open(partial)
            .await
            .map_err(|e| format!("Could not create backup: {e}"))?;
        if let Some(app) = app {
            update(app, "Capturing configuration", Some(SHOW), Some(0));
        }
        cli.send(SHOW).await?;
        let (_, output, bytes) = cli
            .receive(Some(&mut file), false, CAPTURE_TIMEOUT, Some(&report))
            .await?;
        if command_failed(&output) || bytes == 0 {
            return Err(
                "Configuration capture was empty or the appliance rejected the command.".into(),
            );
        }
        file.flush().await.map_err(|e| e.to_string())?;
        file.sync_all().await.map_err(|e| e.to_string())?;
        if let Some(app) = app {
            update(
                app,
                "Backup saved; finishing session",
                Some("Complete configuration flushed to disk"),
                Some(bytes),
            );
        }
        Ok(bytes)
    }
    .await;
    let cleanup = if keys_may_be_visible {
        restore_private_keys(cli, app).await
    } else {
        Ok(())
    };
    let warning = cleanup.err().map(|_| "Could not confirm private-key-display none. Check the appliance immediately; private keys may still be visible.".to_string());
    let bytes = match capture {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(match warning {
                Some(warning) => format!("{error} {warning}"),
                None => error,
            });
        }
    };
    Ok((bytes, warning))
}

async fn run_backup(
    app: &AppHandle,
    root: &std::path::Path,
    host: &str,
    request: BackupRequest,
) -> Result<BackupRecord, String> {
    let mut session = SshConnection::connect(SshOptions::new(
        host,
        ssh_port(request.mocked),
        root.join("backup-ssh-known-hosts"),
    ))
    .await?;
    let report = |event| ssh_progress(Some(app), event);
    let result: Result<BackupRecord, String> = async {
        update(
            app,
            "Authenticating",
            Some("Authenticate with saved credentials"),
            None,
        );
        session
            .authenticate(&request.username, &request.password, Some(&report))
            .await?;
        let command = if request.mocked {
            let command = r"powershell.exe -NoProfile -File C:\ssh-dummy\dummy.ps1";
            update(app, "Starting dummy CLI", Some(command), None);
            Some(command)
        } else {
            None
        };
        let mut cli = session.open_cli(command, sgos_prompt_policy()).await?;
        let id = get_backup_status(app.state()).id;
        let partial = backup_store::path(root, &id, "part")?;
        let (bytes, warning) = capture_configuration(
            &mut cli,
            &request.password,
            request.mode,
            &partial,
            Some(app),
        )
        .await?;
        let record = BackupRecord {
            id,
            appliance: request.appliance,
            address: host.into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            mode: request.mode,
            mocked: request.mocked,
            bytes,
            warning,
        };
        Ok(record)
    }
    .await;
    update(app, "Closing SSH connection", Some("Disconnect SSH"), None);
    let disconnect = session.disconnect().await;
    let result = match (result, disconnect) {
        (Ok(record), Ok(())) => Ok(record),
        (Ok(mut record), Err(_)) => {
            let warning = "Backup saved, but SSH disconnect could not be confirmed.";
            record.warning = Some(
                record
                    .warning
                    .map_or(warning.into(), |value| format!("{value} {warning}")),
            );
            Ok(record)
        }
        (Err(error), _) => Err(error),
    };
    let record = result?;
    if let Err(error) = backup_store::publish(root, &record) {
        let _ = tokio::fs::remove_file(backup_store::path(root, &record.id, "part")?).await;
        return Err(record
            .warning
            .map_or(error.clone(), |warning| format!("{error} {warning}")));
    }
    Ok(record)
}

#[cfg(test)]
#[path = "backup_manager_tests.rs"]
mod ssh_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mock_destination_never_uses_appliance_address() {
        let mut request = BackupRequest {
            appliance: "Production".into(),
            address: "real-appliance.example".into(),
            username: "u".into(),
            password: "p".into(),
            mode: BackupMode::Encrypted,
            mocked: true,
        };
        assert_eq!(destination(&request).unwrap(), "127.0.0.1");
        assert_eq!(ssh_port(request.mocked), 2222);
        request.mocked = false;
        assert_eq!(ssh_port(request.mocked), 22);
        assert_eq!(destination(&request).unwrap(), "real-appliance.example");
    }
}
