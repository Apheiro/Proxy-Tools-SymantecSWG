use super::*;
use crate::ssh_client::password_challenge;
use russh::{client, server, Channel, ChannelId};
use std::{path::PathBuf, sync::Arc};
pub(crate) const TEST_PASSWORD: &str = r#"test!\*&$'" ñ password"#;

struct Dummy {
    auth_round: usize,
    privileged: bool,
    config: bool,
    visible: bool,
    waiting_password: bool,
    inline_policy: bool,
    policy_delimiter: String,
    policy_text: String,
    policy_buffer: String,
    script_mode: bool,
    input: Vec<u8>,
    commands: Arc<Mutex<Vec<String>>>,
    payload: Arc<Vec<u8>>,
    failure: &'static str,
}

impl Dummy {
    fn prompt(&self) -> &'static [u8] {
        if self.config {
            b"Blue Coat#(config) "
        } else if self.privileged {
            b"Blue Coat# "
        } else {
            b"Blue Coat> "
        }
    }
}

impl server::Handler for Dummy {
    type Error = russh::Error;
    async fn auth_password(
        &mut self,
        user: &str,
        password: &str,
    ) -> Result<server::Auth, Self::Error> {
        if self.failure == "interactive" {
            return Ok(server::Auth::Reject {
                proceed_with_methods: Some((&[russh::MethodKind::KeyboardInteractive][..]).into()),
                partial_success: false,
            });
        }
        if user == "test" && password == TEST_PASSWORD {
            Ok(server::Auth::Accept)
        } else {
            Ok(server::Auth::reject())
        }
    }
    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _: &str,
        response: Option<server::Response<'a>>,
    ) -> Result<server::Auth, Self::Error> {
        use std::borrow::Cow;
        if self.failure != "interactive" {
            return Ok(server::Auth::reject());
        }
        if let Some(mut response) = response {
            let value = response.next();
            let valid = match self.auth_round {
                0 => value.is_none(),
                1 => value.as_deref() == Some(user.as_bytes()),
                2 => value.as_deref() == Some(&b""[..]),
                _ => value.as_deref() == Some(TEST_PASSWORD.as_bytes()),
            };
            if !valid {
                return Ok(server::Auth::reject());
            }
            if self.auth_round == 3 {
                return Ok(server::Auth::Accept);
            }
            self.auth_round += 1;
        }
        let prompts = match self.auth_round {
            0 => vec![],
            1 => vec![(Cow::Borrowed("Usuario:"), true)],
            2 => vec![(Cow::Borrowed(""), false)],
            _ => vec![(Cow::Borrowed("Contraseña:"), false)],
        };
        Ok(server::Auth::Partial {
            name: Cow::Borrowed("Test challenge"),
            instructions: Cow::Borrowed(""),
            prompts: Cow::Owned(prompts),
        })
    }
    async fn channel_open_session(
        &mut self,
        _: Channel<server::Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut server::Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _: &str,
        _: u32,
        _: u32,
        _: u32,
        _: u32,
        _: &[(russh::Pty, u32)],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }
    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, b"Dummy banner\r\nBlue Coat> ".to_vec())?;
        Ok(())
    }
    async fn exec_request(
        &mut self,
        channel: ChannelId,
        command: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        if command == b"sh -s" {
            self.script_mode = true;
            session.channel_success(channel)?;
        } else {
            session.channel_failure(channel)?;
        }
        Ok(())
    }
    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        if self.script_mode {
            let script = std::mem::take(&mut self.input);
            let sender = session.handle();
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                let mut child = tokio::process::Command::new("sh")
                    .arg("-s")
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .unwrap();
                child
                    .stdin
                    .take()
                    .unwrap()
                    .write_all(&script)
                    .await
                    .unwrap();
                let output = child.wait_with_output().await.unwrap();
                for chunk in output.stdout.chunks(997) {
                    if sender.data(channel, chunk.to_vec()).await.is_err() {
                        return;
                    }
                }
                let _ = sender
                    .exit_status_request(channel, output.status.code().unwrap_or(1) as u32)
                    .await;
                let _ = sender.eof(channel).await;
                let _ = sender.close(channel).await;
            });
        }
        Ok(())
    }
    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut server::Session,
    ) -> Result<(), Self::Error> {
        if self.script_mode {
            self.input.extend_from_slice(data);
            return Ok(());
        }
        if data.contains(&3) {
            self.input.clear();
            session.data(channel, self.prompt().to_vec())?;
            return Ok(());
        }
        self.input.extend_from_slice(data);
        while let Some(end) = self.input.iter().position(|c| *c == b'\r' || *c == b'\n') {
            let line = String::from_utf8_lossy(&self.input[..end]).into_owned();
            let command = line.trim().to_owned();
            self.input.drain(..=end);
            if self.inline_policy {
                self.commands.lock().unwrap().push(line.clone());
                if line == self.policy_delimiter {
                    self.inline_policy = false;
                    if self.policy_delimiter == "EOF" {
                        session.data(channel, b"Policy installed\r\nBlue Coat# ".to_vec())?;
                    } else if self.failure == "policy-compile" {
                        session.data(channel, b"Error: CPL compilation failed\r\n".to_vec())?;
                        session.data(channel, self.prompt().to_vec())?;
                    } else {
                        self.policy_text = self.policy_buffer.clone();
                        session.data(channel, b"  ok\r\n".to_vec())?;
                        session.data(channel, self.prompt().to_vec())?;
                    }
                } else {
                    self.policy_buffer.push_str(&line);
                    self.policy_buffer.push('\n');
                    session.data(channel, format!("{line}\r\n").into_bytes())?;
                }
                continue;
            }
            if self.waiting_password {
                self.waiting_password = false;
                self.privileged = command == TEST_PASSWORD;
                session.data(
                    channel,
                    format!(
                        "\r\n{}\r\n",
                        if self.privileged {
                            "Privileged mode enabled."
                        } else {
                            "Access denied."
                        }
                    )
                    .into_bytes(),
                )?;
                session.data(channel, self.prompt().to_vec())?;
                continue;
            }
            if command.is_empty() {
                session.data(channel, self.prompt().to_vec())?;
                continue;
            }
            self.commands.lock().unwrap().push(command.clone());
            match command.as_str() {
                value if value.starts_with("inline policy local ") && self.privileged => {
                    self.inline_policy = true;
                    self.policy_delimiter = value
                        .strip_prefix("inline policy local ")
                        .unwrap()
                        .to_owned();
                    self.policy_buffer.clear();
                    session.data(channel, b"Enter policy; finish with EOF\r\n".to_vec())?;
                    continue;
                }
                "show sources policy local" if self.config => {
                    let sender = session.handle();
                    let output = self.policy_text.clone();
                    let prompt = self.prompt().to_vec();
                    tokio::spawn(async move {
                        for chunk in output.as_bytes().chunks(997) {
                            if sender.data(channel, chunk.to_vec()).await.is_err() {
                                return;
                            }
                        }
                        let _ = sender.data(channel, prompt).await;
                    });
                    continue;
                }
                "enable" => {
                    self.waiting_password = true;
                    // Fragment the interactive challenge across SSH messages.
                    session.data(channel, b"Pass".to_vec())?;
                    session.data(channel, b"word:\r\n".to_vec())?;
                    continue;
                }
                "config terminal" if self.privileged => {
                    self.config = true;
                }
                "exit" if self.config => {
                    self.config = false;
                }
                "security private-key-display unencrypted" if self.config => {
                    self.visible = true;
                }
                "security private-key-display none" if self.config => {
                    if self.failure == "cleanup" {
                        session.data(channel, b"Error: cleanup rejected\r\n".to_vec())?;
                        session.data(channel, self.prompt().to_vec())?;
                        continue;
                    }
                    self.visible = false;
                }
                SHOW if self.privileged && !self.config => {
                    if self.failure == "show" {
                        session.data(channel, b"Error: capture rejected\r\n".to_vec())?;
                    } else {
                        // This crosses SSH receive-window boundaries and the old 64 KiB diagnostic buffer.
                        let sender = session.handle();
                        let payload = self.payload.clone();
                        let visible = self.visible;
                        let failure = self.failure;
                        tokio::spawn(async move {
                            for chunk in payload.chunks(997) {
                                if sender.data(channel, chunk.to_vec()).await.is_err() {
                                    return;
                                }
                            }
                            if failure == "eof" {
                                let _ = sender.eof(channel).await;
                                return;
                            }
                            // A quiet gap must not be mistaken for capture completion.
                            tokio::time::sleep(Duration::from_millis(400)).await;
                            if visible {
                                let _ = sender.data(channel, b"-----BEGIN DUMMY PRIVATE KEY-----\r\nSYNTHETIC\r\n-----END DUMMY PRIVATE KEY-----\r\n".to_vec()).await;
                            }
                            let _ = sender
                                .data(
                                    channel,
                                    b"# End of generated test configuration\r\nBlue ".to_vec(),
                                )
                                .await;
                            let _ = sender.data(channel, b"Coat# ".to_vec()).await;
                        });
                        continue;
                    }
                }
                _ => {
                    session.data(channel, b"Error: wrong CLI mode\r\n".to_vec())?;
                }
            }
            session.data(channel, self.prompt().to_vec())?;
        }
        Ok(())
    }
}

pub(crate) async fn fixture_connection(
    failure: &'static str,
) -> (
    SshConnection,
    Arc<Mutex<Vec<String>>>,
    PathBuf,
    Arc<Vec<u8>>,
) {
    let commands = Arc::new(Mutex::new(Vec::new()));
    let payload = Arc::new(
        "!- configuración\r\nhostname DUMMY-SWG-001\r\n"
            .repeat(50_000)
            .into_bytes(),
    );
    let handler = Dummy {
        auth_round: 0,
        privileged: false,
        config: false,
        visible: false,
        waiting_password: false,
        inline_policy: false,
        policy_delimiter: String::new(),
        policy_text: "<Proxy>\r\n; original\r\nallow\r\n".into(),
        policy_buffer: String::new(),
        script_mode: false,
        input: Vec::new(),
        commands: commands.clone(),
        payload: payload.clone(),
        failure,
    };
    let key =
        russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    let config = Arc::new(server::Config {
        keys: vec![key],
        window_size: if failure == "small-window" {
            1024
        } else {
            2 * 1024 * 1024
        },
        auth_rejection_time: Duration::ZERO,
        auth_rejection_time_initial: Some(Duration::ZERO),
        ..Default::default()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let server = server::run_stream(config, stream, handler).await.unwrap();
        let _ = server.await;
    });
    let root = std::env::temp_dir().join(backup_store::new_id("ssh-test"));
    std::fs::create_dir_all(&root).unwrap();
    let session = SshConnection::connect(SshOptions::new(
        "127.0.0.1",
        address.port(),
        root.join("known-hosts"),
    ))
    .await
    .unwrap();
    (session, commands, root, payload)
}

async fn fixture(
    failure: &'static str,
) -> (
    Cli,
    SshConnection,
    Arc<Mutex<Vec<String>>>,
    PathBuf,
    Arc<Vec<u8>>,
) {
    let (mut session, commands, root, payload) = fixture_connection(failure).await;
    session
        .authenticate("test", TEST_PASSWORD, None)
        .await
        .unwrap();
    let cli = session.open_cli(None, sgos_prompt_policy()).await.unwrap();
    (cli, session, commands, root, payload)
}

#[tokio::test]
async fn complete_large_capture_and_both_modes_follow_device_prompt_sequence() {
    for mode in [BackupMode::Encrypted, BackupMode::Unencrypted] {
        let (mut cli, session, commands, root, payload) = fixture("").await;
        let partial = root.join("backup.part");
        let (bytes, warning) = capture_configuration(&mut cli, TEST_PASSWORD, mode, &partial, None)
            .await
            .unwrap();
        assert!(warning.is_none());
        let actual = std::fs::read(&partial).unwrap();
        let mut expected = payload.as_ref().clone();
        if mode == BackupMode::Unencrypted {
            expected.extend_from_slice(b"-----BEGIN DUMMY PRIVATE KEY-----\r\nSYNTHETIC\r\n-----END DUMMY PRIVATE KEY-----\r\n");
        }
        expected.extend_from_slice(b"# End of generated test configuration\r\n");
        assert_eq!(actual.len() as u64, bytes);
        assert_eq!(actual, expected);
        let expected_commands = if mode == BackupMode::Unencrypted {
            vec![
                "enable",
                "config terminal",
                "security private-key-display unencrypted",
                "exit",
                SHOW,
                "config terminal",
                "security private-key-display none",
                "exit",
            ]
        } else {
            vec!["enable", SHOW]
        };
        assert_eq!(*commands.lock().unwrap(), expected_commands);
        session.disconnect().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn rejected_show_restores_key_display_and_does_not_keep_partial_backup() {
    let (mut cli, session, commands, root, _) = fixture("show").await;
    let partial = root.join("backup.part");
    let error = capture_configuration(
        &mut cli,
        TEST_PASSWORD,
        BackupMode::Unencrypted,
        &partial,
        None,
    )
    .await
    .unwrap_err();
    assert!(error.contains("rejected"));
    assert!(!error.contains("may still be visible"));
    assert!(!partial.exists());
    assert!(commands
        .lock()
        .unwrap()
        .contains(&"security private-key-display none".into()));
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn cleanup_failure_preserves_complete_output_and_reports_warning() {
    let (mut cli, session, _, root, _) = fixture("cleanup").await;
    let partial = root.join("backup.part");
    let (_, warning) = capture_configuration(
        &mut cli,
        TEST_PASSWORD,
        BackupMode::Unencrypted,
        &partial,
        None,
    )
    .await
    .unwrap();
    assert!(warning.unwrap().contains("may still be visible"));
    assert!(partial.is_file());
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn early_eof_never_publishes_truncated_configuration() {
    let (mut cli, session, _, root, _) = fixture("eof").await;
    let partial = root.join("backup.part");
    let error = capture_configuration(
        &mut cli,
        TEST_PASSWORD,
        BackupMode::Encrypted,
        &partial,
        None,
    )
    .await
    .unwrap_err();
    assert!(error.contains("before the final prompt"));
    assert!(!partial.exists());
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn keyboard_interactive_handles_information_username_empty_and_localized_password_rounds() {
    let (mut cli, session, _, root, _) = fixture("interactive").await;
    let (bytes, warning) = capture_configuration(
        &mut cli,
        TEST_PASSWORD,
        BackupMode::Encrypted,
        &root.join("backup.part"),
        None,
    )
    .await
    .unwrap();
    assert!(bytes > 2_000_000);
    assert!(warning.is_none());
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn rejected_password_reports_methods_without_exposing_secrets() {
    let (mut session, _, root, _) = fixture_connection("").await;
    let wrong = "wrong-secret-not-for-errors";
    let error = session.authenticate("test", wrong, None).await.unwrap_err();
    assert!(error.contains("authentication"));
    assert!(error.contains("Server methods:"));
    assert!(!error.contains(wrong));
    assert!(!error.contains(TEST_PASSWORD));
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn password_prompts_preserve_characters_and_do_not_answer_mfa_with_a_password() {
    let p = |value: &str, echo| client::Prompt {
        prompt: value.into(),
        echo,
    };
    assert_eq!(
        password_challenge(&p("Password:", false), "test", TEST_PASSWORD).unwrap(),
        TEST_PASSWORD
    );
    assert_eq!(
        password_challenge(&p("", false), "test", TEST_PASSWORD).unwrap(),
        ""
    );
    assert!(password_challenge(&p("One-time password:", false), "test", TEST_PASSWORD).is_err());
}

#[tokio::test]
#[ignore = "Manual loopback dummy probe; reads passwords from stdin with terminal echo disabled"]
async fn manual_loopback_dummy_enable_probe() {
    fn password(label: &str) -> String {
        println!("{label}");
        let mut value = String::new();
        std::io::stdin().read_line(&mut value).unwrap();
        value.trim_end_matches(['\r', '\n']).to_owned()
    }
    let user = std::env::var("PROXYTOOLS_SSH_USER").expect("Set PROXYTOOLS_SSH_USER");
    let login = password("SSH login password (terminal echo must be disabled):");
    let enable = password("Dummy enable password (terminal echo must be disabled):");
    let root = std::env::temp_dir().join(backup_store::new_id("manual-dummy-probe"));
    std::fs::create_dir_all(&root).unwrap();
    let mut session =
        SshConnection::connect(SshOptions::new("127.0.0.1", 2222, root.join("known-hosts")))
            .await
            .unwrap();
    session.authenticate(&user, &login, None).await.unwrap();
    println!("SSH password authentication succeeded.");
    let mut cli = session
        .open_cli(
            Some(r"powershell.exe -NoProfile -File C:\ssh-dummy\dummy.ps1"),
            sgos_prompt_policy(),
        )
        .await
        .unwrap();
    let result = capture_configuration(
        &mut cli,
        &enable,
        BackupMode::Encrypted,
        &root.join("backup.part"),
        None,
    )
    .await;
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
    let (bytes, warning) = result.unwrap();
    assert!(warning.is_none());
    println!("Dummy CLI backup captured: {bytes} bytes.");
}

#[tokio::test]
async fn distinct_enable_password_is_reported_without_creating_a_backup() {
    let (mut cli, session, commands, root, _) = fixture("").await;
    let partial = root.join("backup.part");
    let error = capture_configuration(
        &mut cli,
        "different-enable-password",
        BackupMode::Encrypted,
        &partial,
        None,
    )
    .await
    .unwrap_err();
    assert!(error.contains("Enable rejected the saved password"));
    assert!(!error.contains("different-enable-password"));
    assert!(!partial.exists());
    assert_eq!(*commands.lock().unwrap(), ["enable"]);
    session.disconnect().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
