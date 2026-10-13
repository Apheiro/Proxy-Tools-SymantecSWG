# Shared SSH automation

`src-tauri/src/ssh_client.rs` provides the native SSH connection and interactive CLI used by Backup Manager. It has no Tauri or backup-storage dependency. Future automations should reuse this module and keep their command sequences, destination selection and cleanup in their own workflow modules.

## API

- `SshOptions::new(host, port, known_hosts)` configures the destination and host-key file. Operation and idle timeouts, PTY dimensions, terminal type and echo are configurable. Set `pty = None` for a channel that does not need a PTY.
- `SshConnection::connect` verifies server keys using the existing trust-on-first-use behavior and rejects changed keys.
- `authenticate(username, password, reporter)` supports password and keyboard-interactive authentication. Obtain credentials through the application's existing credential mechanism; this module does not store them.
- `open_cli(None, policy)` opens the remote shell. Supply `Some(command)` to run an interactive remote program on the same connection.
- `PromptPolicy::new(pattern, suffixes)` defines the initial prompt's base through regex capture group 1, then recognizes exact prompts with that base and a configured suffix. `line_ending` defaults to CR and can be changed for another CLI.
- `Cli::receive` waits for a prompt or an explicitly allowed password challenge. An optional asynchronous writer receives the complete output, excluding the final prompt. The returned diagnostic text is bounded and must not be used as the complete output.
- `Cli::command` sends a command, waits for its final prompt and checks common CLI error responses. Workflows can use `send` and `receive` separately for additional challenges or device-specific validation.
- `Cli::interrupt` attempts to recover the prompt after an interrupted command. `SshConnection::disconnect` closes the connection; callers must invoke it after both successful and failed workflows.

Optional `SshEvent` callbacks report authentication steps, commands and output byte counts. They contain no passwords. Callers map these events to their own UI or logging system and must avoid submitting secret values as command labels.

## Workflow ownership

Backup Manager remains responsible for selecting `127.0.0.1:2222` in Mocked Data, launching the remote dummy, SGOS prompt rules, privilege elevation, private-key-display restoration and backup publication. The shared client does not select live/mock credentials, destinations or output paths.

For another automation, configure its prompt policy, read the initial prompt with `receive`, run its commands, validate its output, perform any required cleanup, and disconnect even when an earlier step fails. Use a writer for extensive output: neither idle gaps nor the diagnostic prefix indicate successful completion.

Tests use an isolated SSH fixture to cover authentication, long output, fragmented prompts, command errors and cleanup. Prompt-policy unit tests also cover a different shell syntax, ensuring the shared module does not require SGOS prompts.
