//! Shared native SSH transport and interactive CLI, independent of Tauri and backup workflows.
use russh::{client, keys::PublicKeyOrCertificate, Channel, ChannelMsg, Disconnect};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    time::{timeout, Instant},
};

pub(crate) enum SshEvent {
    Authentication(String),
    Command(String),
    OutputBytes(u64),
}
pub(crate) type Reporter<'a> = dyn Fn(SshEvent) + Send + Sync + 'a;
fn notify(reporter: Option<&Reporter<'_>>, event: SshEvent) {
    if let Some(reporter) = reporter {
        reporter(event);
    }
}

pub(crate) struct PtyOptions {
    pub terminal: String,
    pub columns: u32,
    pub rows: u32,
    pub echo: bool,
}
impl Default for PtyOptions {
    fn default() -> Self {
        Self {
            terminal: "dumb".into(),
            columns: 240,
            rows: 1000,
            echo: false,
        }
    }
}
pub(crate) struct SshOptions {
    pub host: String,
    pub port: u16,
    pub known_hosts: PathBuf,
    pub operation_timeout: Duration,
    pub idle_timeout: Duration,
    pub pty: Option<PtyOptions>,
    pub persistent: bool,
}
impl SshOptions {
    pub(crate) fn new(host: impl Into<String>, port: u16, known_hosts: PathBuf) -> Self {
        Self {
            host: host.into(),
            port,
            known_hosts,
            operation_timeout: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(60),
            pty: Some(PtyOptions::default()),
            persistent: false,
        }
    }
}

pub(crate) struct PromptPolicy {
    initial: regex::Regex,
    suffixes: Vec<String>,
    pub line_ending: String,
}
impl PromptPolicy {
    /// The first capture group identifies the device/shell prompt base.
    pub(crate) fn new(initial: &str, suffixes: &[&str]) -> Result<Self, String> {
        let initial = regex::Regex::new(initial).map_err(|e| e.to_string())?;
        if initial.captures_len() < 2 || suffixes.is_empty() {
            return Err(
                "SSH prompt policy requires a base capture and at least one suffix.".into(),
            );
        }
        Ok(Self {
            initial,
            suffixes: suffixes.iter().map(|value| (*value).into()).collect(),
            line_ending: "\r".into(),
        })
    }
}

pub(crate) struct SshConnection {
    handle: client::Handle<SshHost>,
    options: SshOptions,
}
impl SshConnection {
    pub(crate) async fn connect(options: SshOptions) -> Result<Self, String> {
        if options.host.trim().is_empty() || options.port == 0 {
            return Err("SSH destination is invalid.".into());
        }
        let config = Arc::new(client::Config {
            inactivity_timeout: (!options.persistent).then_some(options.idle_timeout),
            keepalive_interval: options.persistent.then_some(Duration::from_secs(30)),
            ..Default::default()
        });
        let handler = SshHost {
            host: options.host.clone(),
            port: options.port,
            known_hosts: options.known_hosts.clone(),
        };
        let handle = bounded(
            client::connect(config, (options.host.as_str(), options.port), handler),
            options.operation_timeout,
        )
        .await?;
        Ok(Self { handle, options })
    }
    pub(crate) async fn authenticate(
        &mut self,
        user: &str,
        password: &str,
        reporter: Option<&Reporter<'_>>,
    ) -> Result<(), String> {
        authenticate(
            &mut self.handle,
            user,
            password,
            reporter,
            self.options.operation_timeout,
        )
        .await
    }
    /// Opens the server shell or runs a supplied interactive command using the same connection.
    pub(crate) async fn open_cli(
        &self,
        command: Option<&str>,
        policy: PromptPolicy,
    ) -> Result<Cli, String> {
        let channel = self.open_shell(command).await?;
        Ok(Cli {
            channel,
            base: String::new(),
            current_prompt: String::new(),
            at_prompt: false,
            operation_timeout: self.options.operation_timeout,
            idle_timeout: self.options.idle_timeout,
            policy,
        })
    }

    /// Raw streaming shell for interactive consoles; automation keeps using Cli.
    pub(crate) async fn open_shell(
        &self,
        command: Option<&str>,
    ) -> Result<Channel<client::Msg>, String> {
        let duration = self.options.operation_timeout;
        let channel = bounded(self.handle.channel_open_session(), duration).await?;
        if let Some(pty) = &self.options.pty {
            bounded(
                channel.request_pty(
                    true,
                    &pty.terminal,
                    pty.columns,
                    pty.rows,
                    0,
                    0,
                    &[(russh::Pty::ECHO, u32::from(pty.echo))],
                ),
                duration,
            )
            .await?;
        }
        if let Some(command) = command {
            bounded(channel.exec(true, command), duration).await?;
        } else {
            bounded(channel.request_shell(true), duration).await?;
        }
        Ok(channel)
    }
    /// Non-interactive scripts use a channel without a PTY and require exit status zero.
    pub(crate) async fn execute(
        &self,
        command: &str,
        input: &[u8],
        limit: usize,
    ) -> Result<Vec<u8>, String> {
        let mut channel = bounded(
            self.handle.channel_open_session(),
            self.options.operation_timeout,
        )
        .await?;
        bounded(channel.exec(true, command), self.options.operation_timeout).await?;
        let mut writer = channel.make_writer();
        let sender = async {
            writer
                .write_all(input)
                .await
                .map_err(|_| "SSH script upload failed.".to_string())?;
            writer
                .shutdown()
                .await
                .map_err(|_| "SSH script EOF failed.".to_string())
        };
        let receiver = async {
            let mut output = Vec::new();
            let mut status = None;
            let mut stderr = false;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => {
                        if output.len() + data.len() > limit {
                            return Err(
                                "SSH output exceeds the document limit; output was not truncated."
                                    .into(),
                            );
                        }
                        output.extend_from_slice(&data);
                    }
                    ChannelMsg::ExtendedData { .. } => stderr = true,
                    ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
                    ChannelMsg::Close => break,
                    _ => (),
                }
            }
            match status { Some(0) if !stderr=>Ok(output), Some(73)=>Err("Remote file is locked by another editor.".into()), Some(74)=>Err("Remote file changed. Reload and compare before saving.".into()), _=>Err("Remote script failed. Check the shell, path, permissions and required utilities. Original file was not deliberately removed.".into()) }
        };
        let (_, output) = timeout(Duration::from_secs(120), async {
            tokio::try_join!(sender, receiver)
        })
        .await
        .map_err(|_| {
            "SSH script timed out; reload the remote file to verify its state.".to_string()
        })??;
        Ok(output)
    }
    pub(crate) async fn disconnect(&self) -> Result<(), String> {
        bounded(
            self.handle
                .disconnect(Disconnect::ByApplication, "SSH automation finished", "en"),
            self.options.operation_timeout,
        )
        .await
    }
}

struct SshHost {
    host: String,
    port: u16,
    known_hosts: PathBuf,
}
impl client::Handler for SshHost {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let public = key.public_key();
        match russh::keys::check_known_hosts_path(&self.host, self.port, &public, &self.known_hosts)
        {
            Ok(true) => Ok(true),
            Ok(false) => {
                if !russh::keys::known_hosts::known_host_keys_path(
                    &self.host,
                    self.port,
                    &self.known_hosts,
                )
                .map_err(|e| russh::Error::IO(std::io::Error::other(e.to_string())))?
                .is_empty()
                {
                    return Err(russh::Error::IO(std::io::Error::other(
                        "SSH host key changed; saved credentials were not sent.",
                    )));
                }
                russh::keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    &public,
                    &self.known_hosts,
                )
                .map_err(|e| russh::Error::IO(std::io::Error::other(e.to_string())))?;
                Ok(true)
            }
            Err(e) => Err(russh::Error::IO(std::io::Error::other(format!(
                "SSH host key verification failed: {e}"
            )))),
        }
    }
}

async fn bounded<T>(
    future: impl std::future::Future<Output = Result<T, russh::Error>>,
    duration: Duration,
) -> Result<T, String> {
    timeout(duration, future)
        .await
        .map_err(|_| "SSH operation timed out.".to_string())?
        .map_err(|e| format!("SSH operation failed: {e}"))
}

fn authentication_methods(methods: &russh::MethodSet) -> String {
    let names: Vec<&str> = methods.iter().map(<&str>::from).collect();
    if names.is_empty() {
        "none".into()
    } else {
        names.join(", ")
    }
}

pub(crate) fn password_challenge(
    prompt: &client::Prompt,
    user: &str,
    password: &str,
) -> Result<String, String> {
    let text = prompt.prompt.trim().to_lowercase();
    // RFC keyboard-interactive permits informational rounds and empty prompts.
    if text.is_empty() {
        return Ok(String::new());
    }
    if !prompt.echo
        && !["one-time", "otp", "token", "verification", "passcode"]
            .iter()
            .any(|word| text.contains(word))
        && [
            "password",
            "passwd",
            "contraseña",
            "contrasena",
            "senha",
            "mot de passe",
            "passwort",
            "kennwort",
        ]
        .iter()
        .any(|word| text.contains(word))
    {
        return Ok(password.to_owned());
    }
    if prompt.echo
        && ["username", "user name", "login", "usuario"]
            .iter()
            .any(|word| text.contains(word))
    {
        return Ok(user.to_owned());
    }
    Err("SSH requested an unsupported interactive challenge. Only saved username/password challenges are supported.".into())
}

async fn authenticate(
    session: &mut client::Handle<SshHost>,
    user: &str,
    password: &str,
    reporter: Option<&Reporter<'_>>,
    operation_timeout: Duration,
) -> Result<(), String> {
    let duration = operation_timeout;
    let user = user.trim();
    let report = |action: &str| notify(reporter, SshEvent::Authentication(action.to_owned()));
    report(&format!("SSH account: {user}"));
    let mut methods = match bounded(session.authenticate_none(user), duration).await? {
        client::AuthResult::Success => return Ok(()),
        client::AuthResult::Failure {
            remaining_methods, ..
        } => remaining_methods,
    };
    report(&format!(
        "Server authentication methods: {}",
        authentication_methods(&methods)
    ));
    let mut password_rejected = false;
    if methods.contains(&russh::MethodKind::Password) {
        report("Try SSH password authentication with saved password");
        match bounded(session.authenticate_password(user, password), duration).await? {
            client::AuthResult::Success => return Ok(()),
            client::AuthResult::Failure {
                remaining_methods,
                partial_success,
            } => {
                password_rejected = !partial_success;
                methods = remaining_methods;
                report(if partial_success {
                    "SSH password accepted; additional authentication required"
                } else {
                    "Server rejected SSH password authentication"
                });
            }
        }
    }
    if !methods.contains(&russh::MethodKind::KeyboardInteractive) {
        return Err(format!("SSH {}. Server methods: {}. Check the saved SSH account/password and server authentication settings; no CLI command has been run yet.", if password_rejected { "server rejected password authentication" } else { "server does not offer a supported password authentication method" }, authentication_methods(&methods)));
    }
    report("Try SSH keyboard-interactive authentication");
    let mut reply = bounded(
        session.authenticate_keyboard_interactive_start(user, None),
        duration,
    )
    .await?;
    let mut rounds = 0;
    let mut password_answered = false;
    loop {
        match reply {
            client::KeyboardInteractiveAuthResponse::Success => return Ok(()),
            client::KeyboardInteractiveAuthResponse::Failure {
                remaining_methods,
                partial_success,
            } => {
                return Err(format!("SSH keyboard-interactive authentication was rejected{}. Server methods: {}. Check the saved SSH account/password; no CLI command has been run yet.", if partial_success { " or requires another authentication factor" } else { "" }, authentication_methods(&remaining_methods)));
            }
            client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                rounds += 1;
                if rounds > 8 {
                    return Err(
                        "SSH interactive authentication exceeded its challenge limit.".into(),
                    );
                }
                let mut responses = Vec::with_capacity(prompts.len());
                let mut has_password = false;
                for prompt in &prompts {
                    let response = password_challenge(prompt, user, password)?;
                    has_password |= !prompt.echo && !prompt.prompt.trim().is_empty();
                    responses.push(response);
                }
                if has_password && password_answered {
                    return Err("SSH repeated the password challenge after rejection; saved password was not retried.".into());
                }
                password_answered |= has_password;
                report(if has_password {
                    "Answer SSH interactive password challenge with saved password"
                } else {
                    "Answer SSH interactive username/information challenge"
                });
                reply = bounded(
                    session.authenticate_keyboard_interactive_respond(responses),
                    duration,
                )
                .await?;
            }
        }
    }
}

pub(crate) fn terminal_text(value: &str) -> std::borrow::Cow<'_, str> {
    static ANSI: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))").unwrap()
    });
    ANSI.replace_all(value, "")
}

pub(crate) fn prompt(
    tail: &[u8],
    base: Option<&str>,
    policy: &PromptPolicy,
) -> Option<(usize, String)> {
    let start = tail.iter().rposition(|c| *c == b'\n').map_or(0, |i| i + 1);
    // Preserve output bytes while recognizing decorated Windows ConPTY prompts.
    let clean = terminal_text(std::str::from_utf8(&tail[start..]).ok()?);
    let line = clean.trim();
    if let Some(base) = base {
        if policy.suffixes.iter().any(|suffix| suffix == "#(config)")
            && line.strip_prefix(base).is_some_and(|suffix| {
                suffix.starts_with("#(config")
                    && suffix.ends_with(')')
                    && !suffix.contains(['\r', '\n'])
            })
        {
            return Some((start, line.to_owned()));
        }
        if policy
            .suffixes
            .iter()
            .any(|suffix| line == format!("{base}{suffix}"))
        {
            return Some((start, line.to_owned()));
        }
        return None;
    }
    policy
        .initial
        .captures(line)
        .map(|captures| (start, captures[1].to_owned()))
}

pub(crate) fn command_failed(output: &str) -> bool {
    terminal_text(output).lines().any(|line| {
        let line = line.trim().to_lowercase();
        line.starts_with("error:")
            || line.starts_with("%")
            || line.starts_with("unknown command:")
            || line == "access denied."
            || line.contains("invalid input detected")
    })
}

pub(crate) struct Cli {
    channel: Channel<client::Msg>,
    base: String,
    current_prompt: String,
    at_prompt: bool,
    operation_timeout: Duration,
    idle_timeout: Duration,
    policy: PromptPolicy,
}

pub(crate) enum Response {
    Prompt(String),
    Password,
}

impl Cli {
    pub(crate) async fn send(&mut self, value: &str) -> Result<(), String> {
        self.at_prompt = false;
        // A PTY enter key is CR, not CRLF: a second newline can answer the
        // subsequent interactive password challenge with an empty password.
        bounded(
            self.channel
                .data(format!("{value}{}", self.policy.line_ending).as_bytes()),
            self.operation_timeout,
        )
        .await
    }

    // Exact prompt detection: idle gaps and byte counts never mean success.
    // A small tail stays in memory while all configuration bytes stream to disk.
    pub(crate) async fn receive(
        &mut self,
        mut file: Option<&mut (dyn AsyncWrite + Unpin + Send)>,
        allow_password: bool,
        budget: Duration,
        reporter: Option<&Reporter<'_>>,
    ) -> Result<(Response, String, u64), String> {
        let deadline = Instant::now() + budget;
        let mut tail = Vec::new();
        let mut preview = Vec::new();
        let mut written = 0_u64;
        let mut last_progress = Instant::now();
        loop {
            let detected = prompt(
                &tail,
                if self.base.is_empty() {
                    None
                } else {
                    Some(&self.base)
                },
                &self.policy,
            );
            let password = allow_password
                && terminal_text(&String::from_utf8_lossy(&tail))
                    .trim_end()
                    .to_ascii_lowercase()
                    .ends_with("password:");
            if password {
                return Ok((Response::Password, String::new(), written));
            }
            let wait = if detected.is_some() {
                Duration::from_millis(200)
            } else {
                self.idle_timeout
            };
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(
                    "SSH command exceeded its timeout; incomplete output was not published.".into(),
                );
            }
            match timeout(wait.min(remaining), self.channel.wait()).await {
                Err(_) => {
                    if let Some((start, value)) = detected {
                        if let Some(file) = file.as_mut() {
                            file.write_all(&tail[..start])
                                .await
                                .map_err(|e| format!("SSH output write failed: {e}"))?;
                            written += start as u64;
                        }
                        self.at_prompt = true;
                        if self.base.is_empty() {
                            self.base = value.clone();
                        } else {
                            self.current_prompt = value.clone();
                        }
                        return Ok((
                            Response::Prompt(value),
                            String::from_utf8_lossy(&preview).into_owned(),
                            written,
                        ));
                    }
                    return Err("SSH output timed out before the final prompt; incomplete output was not published.".into());
                }
                Ok(Some(ChannelMsg::Data { data })) => {
                    let room = 65536_usize.saturating_sub(preview.len());
                    preview.extend_from_slice(&data[..room.min(data.len())]);
                    tail.extend_from_slice(&data);
                    if tail.len() > 4096 {
                        let count = tail.len() - 4096;
                        if let Some(file) = file.as_mut() {
                            file.write_all(&tail[..count])
                                .await
                                .map_err(|e| format!("SSH output write failed: {e}"))?;
                            written += count as u64;
                        }
                        tail.drain(..count);
                    }
                    if last_progress.elapsed() >= Duration::from_millis(250) {
                        notify(reporter, SshEvent::OutputBytes(written + tail.len() as u64));
                        last_progress = Instant::now();
                    }
                }
                Ok(Some(ChannelMsg::ExtendedData { .. })) => {
                    return Err("SSH session reported stderr; output is incomplete.".into())
                }
                Ok(Some(ChannelMsg::Failure)) => {
                    return Err("Server rejected the SSH session request.".into())
                }
                Ok(Some(ChannelMsg::Eof | ChannelMsg::Close)) | Ok(None) => {
                    return Err(
                        "SSH ended before the final prompt; incomplete output was not published."
                            .into(),
                    )
                }
                Ok(Some(_)) => {}
            }
        }
    }

    pub(crate) async fn command(
        &mut self,
        reporter: Option<&Reporter<'_>>,
        command: &str,
    ) -> Result<(), String> {
        notify(reporter, SshEvent::Command(command.into()));
        self.send(command).await?;
        let (_, output, _) = self
            .receive(None, false, self.operation_timeout, None)
            .await?;
        if command_failed(&output) {
            return Err(format!("SSH CLI rejected command: {command}"));
        }
        Ok(())
    }
    /// Full capture with an explicit size limit; never returns a truncated document.
    pub(crate) async fn capture(&mut self, command: &str, limit: usize) -> Result<String, String> {
        self.send(command).await?;
        let mut data = LimitedOutput(Vec::new(), limit);
        self.receive(Some(&mut data), false, Duration::from_secs(120), None)
            .await?;
        let text =
            String::from_utf8(data.0).map_err(|_| "SSH source is not UTF-8 text.".to_string())?;
        let text = terminal_text(&text).into_owned();
        let mut offset = 0;
        let mut source_start = 0;
        for line in text.split_inclusive('\n') {
            offset += line.len();
            if line.trim().is_empty() {
                continue;
            }
            if line.trim() == command
                || line.trim() == format!("{}{}", self.current_prompt, command)
                || line.trim() == format!("{} {}", self.current_prompt, command)
            {
                source_start = offset;
            }
            break;
        }
        let text = text[source_start..].to_owned();
        if command_failed(&text) {
            return Err("Appliance rejected the source command.".into());
        }
        Ok(text)
    }
    pub(crate) async fn enable(&mut self, password: &str) -> Result<(), String> {
        self.receive(None, false, Duration::from_secs(30), None)
            .await?;
        self.send("enable").await?;
        let (response, _, _) = self
            .receive(None, true, Duration::from_secs(30), None)
            .await?;
        let response = if matches!(response, Response::Password) {
            self.send(password).await?;
            self.receive(None, false, Duration::from_secs(30), None)
                .await?
                .0
        } else {
            response
        };
        if !matches!(response,Response::Prompt(ref p) if p==&format!("{}#",self.prompt_base())) {
            return Err("Enable rejected the saved password.".into());
        }
        Ok(())
    }
    /// Upload while consuming output so neither side blocks on the SSH window.
    pub(crate) async fn upload_capture(
        &mut self,
        command: &str,
        input: &[u8],
        limit: usize,
    ) -> Result<String, String> {
        self.send(command).await?;
        let mut writer = self.channel.make_writer();
        let send = async {
            writer.write_all(input).await.map_err(|_| {
                "SSH upload failed; inspect the remote state before retrying.".to_string()
            })
        };
        let mut response = LimitedOutput(Vec::new(), limit);
        tokio::try_join!(
            send,
            self.receive(Some(&mut response), false, Duration::from_secs(120), None)
        )?;
        String::from_utf8(response.0).map_err(|_| "SSH response is not UTF-8.".into())
    }
    pub(crate) fn prompt_base(&self) -> &str {
        &self.base
    }
    pub(crate) fn current_prompt(&self) -> &str {
        &self.current_prompt
    }
    pub(crate) fn at_prompt(&self) -> bool {
        self.at_prompt
    }
    pub(crate) async fn interrupt(&mut self) -> Result<(), String> {
        bounded(self.channel.data(&b"\x03"[..]), self.operation_timeout).await?;
        self.send("").await?;
        self.receive(None, false, self.operation_timeout, None)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_prompts_with_spaces_and_ansi_require_an_exact_final_line() {
        let policy = PromptPolicy::new(
            r"^([A-Za-z0-9][A-Za-z0-9_.: -]{0,127}?)(?:>|#(?:\(config\))?)$",
            &[">", "#", "#(config)"],
        )
        .unwrap();
        assert_eq!(
            prompt(b"Banner\r\nBlue Coat> ", None, &policy),
            Some((8, "Blue Coat".into()))
        );
        assert_eq!(
            prompt(
                b"ok\r\n\x1b[32mBlue Coat#(config)\x1b[0m ",
                Some("Blue Coat"),
                &policy
            ),
            Some((4, "Blue Coat#(config)".into()))
        );
        assert!(prompt(
            b"! configuration mentions Blue Coat#",
            Some("Blue Coat"),
            &policy
        )
        .is_none());
        assert!(prompt(
            b"Blue Coat#\r\nremaining output",
            Some("Blue Coat"),
            &policy
        )
        .is_none());
    }

    #[test]
    fn other_automations_can_supply_shell_prompts_and_line_endings() {
        let mut policy = PromptPolicy::new(r"^(.+?)[#$]$", &["$", "#"]).unwrap();
        policy.line_ending = "\n".into();
        assert_eq!(
            prompt(b"user@host:~$ ", None, &policy),
            Some((0, "user@host:~".into()))
        );
        assert_eq!(
            prompt(b"done\nuser@host:~# ", Some("user@host:~"), &policy),
            Some((5, "user@host:~#".into()))
        );
        assert!(prompt(b"other@host:~$ ", Some("user@host:~"), &policy).is_none());
        assert_eq!(policy.line_ending, "\n");
    }

    #[test]
    fn prompt_policy_rejects_invalid_patterns_and_missing_base_or_suffixes() {
        assert!(PromptPolicy::new("[", &["#"]).is_err());
        assert!(PromptPolicy::new(r"^device#$", &["#"]).is_err());
        assert!(PromptPolicy::new(r"^(device)#$", &[]).is_err());
    }
}

struct LimitedOutput(Vec<u8>, usize);
impl AsyncWrite for LimitedOutput {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        if self.0.len() + buf.len() > self.1 {
            return std::task::Poll::Ready(Err(std::io::Error::other(
                "SSH output exceeds its configured capture limit; capture was rejected.",
            )));
        }
        self.0.extend_from_slice(buf);
        std::task::Poll::Ready(Ok(buf.len()))
    }
    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Ok(()))
    }
    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Ok(()))
    }
}
