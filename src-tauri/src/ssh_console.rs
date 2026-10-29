//! Persistent interactive sessions. Only bounded output windows cross the IPC boundary.
use crate::ssh_client::{self, SshConnection, SshOptions};
use crate::ssh_target::{sgos_prompt_policy, SshTarget};
use russh::ChannelMsg;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::mpsc,
};
use tokio_util::sync::CancellationToken;

const PAGE_BYTES: usize = 32 * 1024;
const MAX_COMMANDS: usize = 5000;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleBlock {
    id: usize,
    command: String,
    created_at: String,
    bytes: u64,
    complete: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSession {
    id: String,
    appliance: String,
    address: String,
    mocked: bool,
    target_kind: String,
    created_at: String,
    phase: String,
    connected: bool,
    busy: bool,
    input_mode: String,
    prompt: String,
    error: Option<String>,
    blocks: Vec<ConsoleBlock>,
}
struct Entry {
    snapshot: Arc<Mutex<ConsoleSession>>,
    sender: mpsc::Sender<Input>,
    directory: PathBuf,
    stop: CancellationToken,
}
#[derive(Default)]
pub struct ConsoleState(Mutex<HashMap<String, Entry>>);
enum Input {
    Line(String, bool),
    Interrupt,
    Continue,
    Close,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    appliance: String,
    address: String,
    username: String,
    password: String,
    mocked: bool,
    #[serde(default = "proxy_target_kind")]
    target_kind: String,
}
fn proxy_target_kind() -> String { "proxy".into() }
fn change(state: &Arc<Mutex<ConsoleSession>>, update: impl FnOnce(&mut ConsoleSession)) {
    update(&mut state.lock().unwrap_or_else(|e| e.into_inner()));
}
fn snapshot(state: &Arc<Mutex<ConsoleSession>>) -> ConsoleSession {
    state.lock().unwrap_or_else(|e| e.into_inner()).clone()
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSummary {
    #[serde(flatten)]
    session: ConsoleSession,
    block_count: usize,
}
#[tauri::command]
pub fn list_ssh_sessions(state: State<'_, ConsoleState>) -> Vec<ConsoleSummary> {
    let entries = state.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut result: Vec<_> = entries
        .values()
        .map(|e| {
            let s = e.snapshot.lock().unwrap_or_else(|e| e.into_inner());
            ConsoleSummary {
                block_count: s.blocks.len(),
                session: ConsoleSession {
                    id: s.id.clone(),
                    appliance: s.appliance.clone(),
                    address: s.address.clone(),
                    mocked: s.mocked,
                    target_kind: s.target_kind.clone(),
                    created_at: s.created_at.clone(),
                    phase: s.phase.clone(),
                    connected: s.connected,
                    busy: s.busy,
                    input_mode: s.input_mode.clone(),
                    prompt: s.prompt.clone(),
                    error: s.error.clone(),
                    blocks: s.blocks.last().cloned().into_iter().collect(),
                },
            }
        })
        .collect();
    result.sort_by(|a, b| b.session.created_at.cmp(&a.session.created_at));
    result
}
#[tauri::command]
pub fn get_ssh_session(
    state: State<'_, ConsoleState>,
    id: String,
) -> Result<ConsoleSession, String> {
    let entries = state
        .0
        .lock()
        .map_err(|_| "SSH sessions are unavailable.")?;
    Ok(snapshot(
        &entries.get(&id).ok_or("Session not found.")?.snapshot,
    ))
}
#[tauri::command]
pub fn connect_ssh_console(
    app: AppHandle,
    state: State<'_, ConsoleState>,
    request: ConnectRequest,
) -> Result<String, String> {
    if !matches!(request.target_kind.as_str(), "proxy" | "isg") { return Err("Unknown SSH target kind.".into()); }
    let target = SshTarget::appliance(&request.address, request.mocked)?;
    if request.username.trim().is_empty()
        || request.password.is_empty()
        || request.password.contains(['\r', '\n'])
    {
        return Err("Configure valid SSH credentials in Settings first.".into());
    }
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let id = format!(
        "ssh-{}-{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let root = crate::check_cache_dir(&app).map_err(|e| e.to_string())?;
    let directory = root.join(&id);
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "SSH sessions are unavailable.")?;
    if entries.len() >= 32 {
        return Err(
            "Close and remove an old session before creating another (32 session limit).".into(),
        );
    }
    std::fs::create_dir(&directory).map_err(|e| format!("Cannot create session cache: {e}"))?;
    let (sender, receiver) = mpsc::channel(32);
    let stop = CancellationToken::new();
    let status = Arc::new(Mutex::new(ConsoleSession {
        id: id.clone(),
        appliance: request.appliance.clone(),
        address: request.address.clone(),
        mocked: request.mocked,
        target_kind: request.target_kind.clone(),
        created_at: chrono::Utc::now().to_rfc3339(),
        phase: "Connecting".into(),
        connected: false,
        busy: true,
        input_mode: "waiting".into(),
        prompt: String::new(),
        error: None,
        blocks: vec![ConsoleBlock {
            id: 0,
            command: "Session started".into(),
            created_at: chrono::Utc::now().to_rfc3339(),
            bytes: 0,
            complete: false,
        }],
    }));
    entries.insert(
        id.clone(),
        Entry {
            snapshot: status.clone(),
            sender,
            directory: directory.clone(),
            stop: stop.clone(),
        },
    );
    tauri::async_runtime::spawn(async move {
        let result = run(
            &root,
            &directory,
            target,
            request,
            status.clone(),
            receiver,
            stop,
        )
        .await;
        change(&status, |s| {
            s.connected = false;
            s.busy = false;
            s.input_mode = "closed".into();
            s.phase = if result.is_ok() {
                "Disconnected"
            } else {
                "Failed"
            }
            .into();
            s.error = result.err();
        });
    });
    Ok(id)
}
#[tauri::command]
pub fn send_ssh_input(
    state: State<'_, ConsoleState>,
    id: String,
    value: String,
    sensitive: bool,
) -> Result<(), String> {
    let entries = state
        .0
        .lock()
        .map_err(|_| "SSH sessions are unavailable.")?;
    let entry = entries.get(&id).ok_or("Session not found.")?;
    let mut current = entry
        .snapshot
        .lock()
        .map_err(|_| "SSH session is unavailable.")?;
    if !current.connected {
        return Err("Session is not connected.".into());
    }
    if current.phase == "Sending input" {
        return Err("Wait for the current input to finish sending.".into());
    }
    let value = normalize_input(&value, sensitive || current.input_mode == "secret")?;
    entry
        .sender
        .try_send(Input::Line(value, sensitive))
        .map_err(|_| "Session is closed or its input queue is full.")?;
    current.phase = "Sending input".into();
    Ok(())
}
fn normalize_input(value: &str, sensitive: bool) -> Result<String, String> {
    if value.len() > MAX_INPUT_BYTES || value.contains('\0') {
        return Err("SSH input must be at most 1 MiB and cannot contain NUL characters.".into());
    }
    if sensitive && (value.len() > 8192 || value.contains(['\r', '\n'])) {
        return Err("Sensitive responses must be a single line of at most 8192 bytes.".into());
    }
    // Normalize Windows paste without trimming indentation, empty lines or whitespace.
    Ok(value.replace("\r\n", "\n").replace('\r', "\n"))
}
fn pty_input(value: &str) -> Vec<u8> {
    let mut bytes = value.replace('\n', "\r").into_bytes();
    // Enter each line once. An existing final newline already submits the last line.
    if !bytes.ends_with(b"\r") {
        bytes.push(b'\r');
    }
    bytes
}

fn enqueue(state: &ConsoleState, id: &str, input: Input) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "SSH sessions are unavailable.")?
        .get(id)
        .ok_or("Session not found.")?
        .sender
        .try_send(input)
        .map_err(|_| "Session is closed or its input queue is full.".into())
}
#[tauri::command]
pub fn interrupt_ssh_console(state: State<'_, ConsoleState>, id: String) -> Result<(), String> {
    enqueue(&state, &id, Input::Interrupt)
}
#[tauri::command]
pub fn continue_ssh_console(state: State<'_, ConsoleState>, id: String) -> Result<(), String> {
    enqueue(&state, &id, Input::Continue)
}
#[tauri::command]
pub fn close_other_ssh_profiles(state: State<'_, ConsoleState>, mocked: bool) {
    if let Ok(entries) = state.0.lock() {
        for entry in entries.values() {
            if snapshot(&entry.snapshot).mocked != mocked {
                entry.stop.cancel();
            }
        }
    }
}
#[tauri::command]
pub fn disconnect_ssh_console(state: State<'_, ConsoleState>, id: String) -> Result<(), String> {
    let entries = state
        .0
        .lock()
        .map_err(|_| "SSH sessions are unavailable.")?;
    let entry = entries.get(&id).ok_or("Session not found.")?;
    entry.stop.cancel();
    let _ = entry.sender.try_send(Input::Close);
    Ok(())
}
#[tauri::command]
pub fn remove_ssh_session(state: State<'_, ConsoleState>, id: String) -> Result<(), String> {
    let mut entries = state
        .0
        .lock()
        .map_err(|_| "SSH sessions are unavailable.")?;
    let entry = entries.get(&id).ok_or("Session not found.")?;
    if !matches!(
        snapshot(&entry.snapshot).phase.as_str(),
        "Disconnected" | "Failed"
    ) {
        return Err("Disconnect this session first.".into());
    }
    std::fs::remove_dir_all(&entry.directory).map_err(|e| e.to_string())?;
    entries.remove(&id);
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputPage {
    text: String,
    next_offset: u64,
    total: u64,
}
#[tauri::command]
pub async fn read_ssh_output(
    state: State<'_, ConsoleState>,
    id: String,
    block: usize,
    offset: u64,
) -> Result<OutputPage, String> {
    let (path, expected_bytes) = {
        let entries = state
            .0
            .lock()
            .map_err(|_| "SSH sessions are unavailable.")?;
        let entry = entries.get(&id).ok_or("Session not found.")?;
        let session = entry
            .snapshot
            .lock()
            .map_err(|_| "SSH session is unavailable.")?;
        let command = session.blocks.get(block).ok_or("Command not found.")?;
        (entry.directory.join(format!("{block}.txt")), command.bytes)
    };
    if expected_bytes == 0 {
        return Ok(OutputPage {
            text: String::new(),
            next_offset: 0,
            total: 0,
        });
    }
    read_page(&path, offset).await
}
async fn read_page(path: &std::path::Path, offset: u64) -> Result<OutputPage, String> {
    let mut file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(e) => return Err(e.to_string()),
    };
    let total = file.metadata().await.map_err(|e| e.to_string())?.len();
    if offset > total {
        return Err("Output offset is out of range.".into());
    }
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(PAGE_BYTES as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    // Files contain UTF-8; keep page boundaries between code points.
    let mut count = 0;
    while count < bytes.len() {
        match std::str::from_utf8(&bytes[count..]) {
            Ok(_) => {
                count = bytes.len();
                break;
            }
            Err(e) => {
                count += e.valid_up_to();
                if let Some(length) = e.error_len() {
                    count += length;
                } else {
                    break;
                }
            }
        }
    }
    if offset + bytes.len() as u64 == total {
        count = bytes.len();
    }
    let text = String::from_utf8_lossy(&bytes[..count]).into_owned();
    Ok(OutputPage {
        text,
        next_offset: offset + count as u64,
        total,
    })
}

/// Redact even secrets echoed across SSH packet boundaries. Passwords never enter metadata.
#[derive(Default)]
struct Redactor {
    secrets: Vec<Vec<u8>>,
    pending: Vec<u8>,
}
impl Redactor {
    fn secret(&mut self, value: &str) {
        if !value.is_empty() && !self.secrets.iter().any(|s| s == value.as_bytes()) {
            self.secrets.push(value.as_bytes().to_vec());
        }
    }
    fn push(&mut self, bytes: &[u8], flush: bool) -> Vec<u8> {
        self.pending.extend_from_slice(bytes);
        let mut output = Vec::new();
        let mut pos = 0;
        while pos < self.pending.len() {
            let rest = &self.pending[pos..];
            if let Some(secret) = self.secrets.iter().find(|s| rest.starts_with(s)) {
                pos += secret.len();
                output.extend_from_slice(b"[redacted]");
            } else if !flush && self.secrets.iter().any(|s| s.starts_with(rest)) {
                break;
            } else {
                output.push(rest[0]);
                pos += 1;
            }
        }
        self.pending.drain(..pos);
        output
    }
}
fn input_mode(tail: &[u8], base: Option<&str>) -> (&'static str, Option<String>) {
    let text = String::from_utf8_lossy(tail);
    let clean = ssh_client::terminal_text(&text);
    let line = clean
        .trim_end()
        .rsplit('\n')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if line.ends_with(':')
        && [
            "password",
            "passphrase",
            "verification code",
            "one-time",
            "otp",
            "contraseña",
            "senha",
            "mot de passe",
        ]
        .iter()
        .any(|s| line.contains(s))
    {
        return ("secret", None);
    }
    if let Some((_, value)) = ssh_client::prompt(tail, base, &sgos_prompt_policy()) {
        return ("command", Some(value));
    }
    // ISG puts configuration context before the privilege marker, unlike SGOS.
    static ISG_PROMPT: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(||
        regex::Regex::new(r"^([A-Za-z0-9_. /:-]{1,120})(?:\([A-Za-z0-9_. /:-]{1,120}\))?[>#]$").unwrap());
    let full_line = clean.trim_end().rsplit('\n').next().unwrap_or("").trim();
    if let Some(captures) = ISG_PROMPT.captures(full_line) {
        if base.is_none_or(|base| base == &captures[1]) {
            return ("command", Some(if base.is_some() { full_line.to_owned() } else { captures[1].to_owned() }));
        }
    }
    if line.contains("--more--")
        || line.contains("press any key")
        || line.ends_with("[y/n]")
        || line.ends_with("(y/n)")
        || line.ends_with("[yes/no]:")
    {
        return ("response", None);
    }
    ("waiting", None)
}
async fn write_output(
    file: &mut tokio::fs::File,
    bytes: &[u8],
    state: &Arc<Mutex<ConsoleSession>>,
) -> Result<(), String> {
    file.write_all(bytes)
        .await
        .map_err(|e| format!("Session output could not be saved: {e}"))?;
    file.flush()
        .await
        .map_err(|e| format!("Session output could not be flushed: {e}"))?;
    change(state, |s| {
        if let Some(block) = s.blocks.last_mut() {
            block.bytes += bytes.len() as u64;
        }
    });
    Ok(())
}
async fn run(
    root: &std::path::Path,
    directory: &std::path::Path,
    target: SshTarget,
    request: ConnectRequest,
    state: Arc<Mutex<ConsoleSession>>,
    mut receiver: mpsc::Receiver<Input>,
    stop: CancellationToken,
) -> Result<(), String> {
    let mut options = SshOptions::new(
        &target.host,
        target.port,
        root.join("backup-ssh-known-hosts"),
    );
    options.persistent = true;
    let setup = async {
        let mut connection = SshConnection::connect(options).await?;
        change(&state, |s| s.phase = "Authenticating".into());
        if let Err(error) = connection
            .authenticate(&request.username, &request.password, None)
            .await
        {
            let _ = connection.disconnect().await;
            return Err(error);
        }
        let shell = connection.open_shell(target.startup).await;
        match shell {
            Ok(channel) => Ok((connection, channel)),
            Err(e) => {
                let _ = connection.disconnect().await;
                Err(e)
            }
        }
    };
    // A close request can also cancel a connection/authentication attempt.
    let (connection, channel) = tokio::select! {
        result = setup => result?,
        _ = receiver.recv() => return Ok(()),
        _ = stop.cancelled() => return Ok(()),
    };
    run_shell(
        connection,
        channel,
        directory,
        &request.password,
        state,
        receiver,
        stop,
    )
    .await
}
async fn run_shell(
    connection: SshConnection,
    channel: russh::Channel<russh::client::Msg>,
    directory: &std::path::Path,
    password: &str,
    state: Arc<Mutex<ConsoleSession>>,
    mut receiver: mpsc::Receiver<Input>,
    stop: CancellationToken,
) -> Result<(), String> {
    change(&state, |s| {
        s.connected = true;
        s.phase = "Connected".into();
    });
    let (mut channel, writer) = channel.split();
    let writer = Arc::new(writer);
    let mut outgoing: Option<Pin<Box<dyn Future<Output = Result<(), String>> + Send>>> = None;
    let mut redactor = Redactor::default();
    redactor.secret(password);
    let mut file = tokio::fs::File::create(directory.join("0.txt"))
        .await
        .map_err(|e| e.to_string())?;
    let mut tail = Vec::new();
    let mut base: Option<String> = None;
    let mut last_data = Instant::now();
    let mut settled = false;
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    let result: Result<(), String> = async {
        loop {
            tokio::select! {
                _ = stop.cancelled() => break,
                sent = async {
                    match outgoing.as_mut() {
                        Some(task) => task.await,
                        None => std::future::pending().await,
                    }
                } => {
                    outgoing = None;
                    sent?;
                    change(&state, |s| s.phase = "Connected".into());
                }
                _ = tick.tick() => {
                    if outgoing.is_none() && !settled && last_data.elapsed() >= Duration::from_millis(250) {
                        let (mode, prompt) = input_mode(&tail, base.as_deref());
                        if mode != "waiting" {
                            write_output(&mut file, &redactor.push(&[], true), &state).await?;
                            if let Some(value) = prompt {
                                if base.is_none() { base = Some(value.clone()); }
                                change(&state, |s| { s.prompt = value; s.busy = false; if let Some(block) = s.blocks.last_mut() { block.complete = true; } });
                            }
                            change(&state, |s| s.input_mode = mode.into());
                            settled = true;
                        }
                    }
                }
                input = receiver.recv() => match input {
                    None | Some(Input::Close) => break,
                    Some(Input::Continue) => {
                        writer.data(&b" "[..]).await.map_err(|e| e.to_string())?;
                        tail.clear(); settled = true;
                        change(&state, |s| s.input_mode = "waiting".into());
                    }
                    Some(Input::Interrupt) => {
                        outgoing = None;
                        change(&state, |s| s.phase = "Connected".into());
                        writer.data(&b"\x03"[..]).await.map_err(|e| e.to_string())?;
                        tail.clear(); settled = true;
                        change(&state, |s| { s.busy = true; s.input_mode = "waiting".into(); if let Some(block) = s.blocks.last_mut() { block.complete = false; } });
                    }
                    Some(Input::Line(value, sensitive)) => {
                        let current = snapshot(&state);
                        let secret = sensitive || current.input_mode == "secret";
                        if !current.busy && !secret && !value.trim().is_empty() {
                            if current.blocks.len() >= MAX_COMMANDS { return Err("Session reached 5000 commands. Start a new session to continue.".into()); }
                            write_output(&mut file, &redactor.push(&[], true), &state).await?;
                            let id = current.blocks.len();
                            file = tokio::fs::File::create(directory.join(format!("{id}.txt"))).await.map_err(|e| e.to_string())?;
                            change(&state, |s| s.blocks.push(ConsoleBlock { id, command: value.clone(), created_at: chrono::Utc::now().to_rfc3339(), bytes: 0, complete: false }));
                        }
                        let value = normalize_input(&value, secret)?;
                        if secret { redactor.secret(&value); }
                        let bytes = pty_input(&value);
                        let sink = writer.clone();
                        // Keep reading while sending: large pasted policies can exceed SSH windows.
                        outgoing = Some(Box::pin(async move { sink.data(bytes.as_slice()).await.map_err(|e| e.to_string()) }));
                        change(&state, |s| s.phase = "Sending input".into());
                        tail.clear(); settled = true;
                        change(&state, |s| { s.busy = true; s.input_mode = "waiting".into(); if let Some(block) = s.blocks.last_mut() { block.complete = false; } });
                    }
                },
                msg = channel.wait() => match msg {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        write_output(&mut file, &redactor.push(&data, false), &state).await?;
                        tail.extend_from_slice(&data);
                        if tail.len() > 4096 { tail.drain(..tail.len()-4096); }
                        // Secret challenges must be recognized before accepting a queued response;
                        // only command-completion prompts need the settling interval.
                        let (mode, _) = input_mode(&tail, base.as_deref());
                        if matches!(mode, "secret" | "response") {
                            change(&state, |s| s.input_mode = mode.into());
                        }
                        last_data = Instant::now(); settled = false;
                    }
                    Some(ChannelMsg::Eof | ChannelMsg::Close) | None => break,
                    Some(ChannelMsg::Failure) => return Err("SSH server rejected the interactive shell.".into()),
                    _ => {}
                }
            }
        }
        Ok(())
    }.await;
    drop(outgoing);
    let flushed = write_output(&mut file, &redactor.push(&[], true), &state).await;
    let _ = writer.close().await;
    let disconnected = connection.disconnect().await;
    result.and(flushed).and(disconnected)
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn wait_for(state: &Arc<Mutex<ConsoleSession>>, mode: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if snapshot(state).input_mode == mode {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await
        .expect("console did not reach expected input state");
    }
    #[tokio::test]
    async fn persistent_shell_preserves_privilege_and_complete_large_output() {
        use crate::backup_manager::ssh_tests::{fixture_connection, TEST_PASSWORD};
        let (mut connection, commands, root, payload) = fixture_connection("small-window").await;
        connection
            .authenticate("test", TEST_PASSWORD, None)
            .await
            .unwrap();
        let channel = connection.open_shell(None).await.unwrap();
        let state = Arc::new(Mutex::new(ConsoleSession {
            id: "test".into(),
            appliance: "dummy".into(),
            address: "127.0.0.1".into(),
            mocked: true,
            target_kind: "proxy".into(),
            created_at: String::new(),
            phase: "Connecting".into(),
            connected: false,
            busy: true,
            input_mode: "waiting".into(),
            prompt: String::new(),
            error: None,
            blocks: vec![ConsoleBlock {
                id: 0,
                command: "Session started".into(),
                created_at: String::new(),
                bytes: 0,
                complete: false,
            }],
        }));
        let (sender, receiver) = mpsc::channel(32);
        let task_state = state.clone();
        let directory = root.clone();
        let task = tokio::spawn(async move {
            run_shell(
                connection,
                channel,
                &directory,
                TEST_PASSWORD,
                task_state,
                receiver,
                CancellationToken::new(),
            )
            .await
        });
        wait_for(&state, "command").await;
        sender
            .send(Input::Line("enable".into(), false))
            .await
            .unwrap();
        wait_for(&state, "secret").await;
        assert_eq!(snapshot(&state).blocks.len(), 2);
        sender
            .send(Input::Line(TEST_PASSWORD.into(), false))
            .await
            .unwrap();
        // Wait until the actor has consumed the password, then for the privileged prompt.
        tokio::time::sleep(Duration::from_millis(80)).await;
        wait_for(&state, "command").await;
        assert_eq!(snapshot(&state).prompt, "Blue Coat#");
        sender
            .send(Input::Line(
                "show configuration expanded noprompts".into(),
                false,
            ))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        wait_for(&state, "command").await;
        sender
            .send(Input::Line("inline policy local EOF".into(), false))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(350)).await;
        assert!(snapshot(&state).busy);
        // A block larger than the old 8 KiB limit, including indentation and empty lines.
        let policy = format!(
            "<Proxy>\r\n  url.domain=example.test allow\r\n\r\n{}",
            "  ; policy comment\r\n".repeat(800)
        );
        let normalized = normalize_input(&policy, false).unwrap();
        sender
            .send(Input::Line(normalized.clone(), false))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            while commands.lock().unwrap().len() < 2 + 1 + normalized.lines().count() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(
            snapshot(&state).busy,
            "policy must remain open until EOF is explicitly sent"
        );
        assert!(!commands.lock().unwrap().iter().any(|line| line == "EOF"));
        sender.send(Input::Line("EOF".into(), false)).await.unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        wait_for(&state, "command").await;
        sender.send(Input::Close).await.unwrap();
        task.await.unwrap().unwrap();
        let status = snapshot(&state);
        assert_eq!(status.blocks.len(), 4);
        assert!(status.blocks[2].complete);
        assert!(status.blocks[3].complete);
        let output = tokio::fs::read(root.join("2.txt")).await.unwrap();
        assert!(output.starts_with(&payload));
        assert!(String::from_utf8_lossy(&output).contains("# End of generated test configuration"));
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains(TEST_PASSWORD));
        let recorded = commands.lock().unwrap();
        assert_eq!(recorded[0], "enable");
        assert_eq!(recorded[1], "show configuration expanded noprompts");
        assert_eq!(recorded[2], "inline policy local EOF");
        assert_eq!(recorded[3], "<Proxy>");
        assert_eq!(recorded[4], "  url.domain=example.test allow");
        assert_eq!(recorded[5], "");
        assert_eq!(recorded.last().unwrap(), "EOF");
        assert!(
            String::from_utf8_lossy(&tokio::fs::read(root.join("3.txt")).await.unwrap())
                .contains("Policy installed")
        );
        drop(recorded);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn multiline_input_preserves_policy_format_and_submits_each_line_once() {
        let input = "<Proxy>\r\n  url.domain=example.test allow\r\n\r\n";
        let normalized = normalize_input(input, false).unwrap();
        assert_eq!(normalized, "<Proxy>\n  url.domain=example.test allow\n\n");
        assert_eq!(
            pty_input(&normalized),
            b"<Proxy>\r  url.domain=example.test allow\r\r"
        );
        assert_eq!(pty_input("EOF"), b"EOF\r");
        assert_eq!(pty_input("EOF\n"), b"EOF\r");
        assert_eq!(pty_input(""), b"\r");
        assert!(normalize_input("password\nEOF", true).is_err());
        assert!(normalize_input("policy\0text", false).is_err());
        assert!(normalize_input(&"x".repeat(MAX_INPUT_BYTES + 1), false).is_err());
    }
    #[test]
    fn fragmented_secrets_are_removed_without_losing_output() {
        let mut redactor = Redactor::default();
        redactor.secret("test-secret");
        let mut output = redactor.push(b"Password: test-", false);
        output.extend(redactor.push(b"secret\r\nBlue Coat#", true));
        assert_eq!(
            String::from_utf8(output).unwrap(),
            "Password: [redacted]\r\nBlue Coat#"
        );
    }
    #[test]
    fn prompts_do_not_treat_arbitrary_output_as_completion() {
        assert_eq!(
            input_mode(b"payload #\nmore output", Some("Blue Coat")).0,
            "waiting"
        );
        assert_eq!(input_mode(b"Password:\r\n", Some("Blue Coat")).0, "secret");
        assert_eq!(input_mode(b"Blue Coat# ", Some("Blue Coat")).0, "command");
        assert_eq!(
            input_mode(b"Continue [y/n]", Some("Blue Coat")).0,
            "response"
        );
    }
    #[tokio::test]
    async fn pages_preserve_unicode_and_large_outputs() {
        let dir = std::env::temp_dir().join(format!("console-pages-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("output.txt");
        let expected = "á🦀line\n".repeat(20_000);
        tokio::fs::write(&path, &expected).await.unwrap();
        let mut result = String::new();
        let mut offset = 0;
        loop {
            let page = read_page(&path, offset).await.unwrap();
            result.push_str(&page.text);
            offset = page.next_offset;
            if offset >= page.total {
                break;
            }
        }
        assert_eq!(expected, result);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
