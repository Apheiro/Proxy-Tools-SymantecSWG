# Backup Manager

Open **Diagnostic tools → Backup Manager** for a registered appliance. The page reuses the application's credential store (Windows Credential Manager in Live mode, the separate mock-management-credentials localStorage entry in Mocked Data, or temporary session credentials), proxy inventory, Mocked Data switch, shared controls and application cache path. No additional login form is introduced. SSH and `enable` use the same saved password; port 22 is used for live connections and 2222 for mocked connections.

The workspace adapts to screen size, with connection controls/activity on the left and saved backups/virtualized preview on the right. The list automatically selects the first available backup and preserves the current selection on refresh. Each row has a Delete action with an appliance/date confirmation. Deletion removes only the validated backup text and metadata files, blocks an in-progress backup, and updates the list and preview. **Open folder** opens the existing application cache directory using the installed Tauri Opener plugin, with the path resolved in Rust rather than accepted from the frontend.

## SSH workflow

Connection, authentication, host-key verification and interactive output handling live in the shared `ssh_client.rs` module, documented in [Shared SSH automation](ssh-automation.md). Backup Manager supplies its SGOS prompt policy and maps progress callbacks to Tauri events; destination selection, command ordering, key-display cleanup and backup storage remain in its workflow.

The native Rust client uses `russh`, an interactive PTY and server-advertised password authentication, with keyboard-interactive username/password challenges supported. Informational rounds, empty prompts and localized password prompts are handled; passwords are transmitted unchanged through the SSH library, including Unicode, backslashes and shell metacharacters. Unsupported MFA challenges are reported without submitting the saved password to them. Progress identifies the SSH account and methods, never the password. Authentication errors report the server methods instead of treating every failure as an incorrect password. The production connection goes directly to the selected appliance; it does not use an HTTP proxy or execute a local SSH command.

1. Connect and authenticate, then wait for the device prompt.
2. Send `enable`. Answer a `Password:` challenge using the saved password and require the privileged `#` prompt.
3. For **Unencrypted**, send `config terminal`, `security private-key-display unencrypted`, then `exit` to return to privileged mode.
4. Send `show configuration expanded noprompts` and stream the complete response to disk until the exact privileged prompt returns.
5. Flush and synchronize the backup file.
6. For **Unencrypted**, re-enter configuration, send `security private-key-display none`, then `exit`. Cleanup is attempted even if the capture or activation command fails. An interrupted capture is resynchronized before cleanup.
7. Disconnect and publish the completed backup in the list.

**Encrypted** follows the requested workflow without changing `private-key-display`; it retains the appliance's existing setting. This label does not mean the local text file is encrypted. **Unencrypted** entries display an orange warning icon. A cleanup failure preserves a complete backup and adds a persistent warning; a failed or incomplete capture is never published as a successful backup.

Commands/connect/authentication have 30-second timeouts; configuration capture allows 30 minutes with a 60-second inactivity timeout. An idle interval without the final prompt is an error, never a successful partial backup. A small rolling tail and a bounded diagnostic prefix are retained in memory; those bounds do not limit the output written to disk. The frontend loads the complete UTF-8 backup and virtualizes its lines with the existing TanStack Virtual dependency. There is no line-count or byte-count truncation. Extremely large files still require memory for their complete text in the WebView.

The native task survives navigation. Concurrent backups are rejected, and normal application close is blocked until capture/cleanup/disconnection finishes. Forced termination, machine shutdown or a broken SSH connection can prevent cleanup; an explicit warning reports an unconfirmed reset when the process remains alive.

## Storage and host keys

Files are written directly under the existing `app.path().app_cache_dir()` (the same runtime directory used by trace captures), without a new storage root:

- `backup-<sanitized-appliance>-<UTC-timestamp>.txt`: complete captured command output, possibly including the device's command echo, excluding its final prompt.
- Matching `.json`: appliance, destination, creation time, mode, mock flag, byte count and warnings.
- `.part`/`.json.part`: unpublished working files. Crashes can leave these artifacts; they are not listed as backups.
- `backup-ssh-known-hosts`: SSH public host-key pins using the library's OpenSSH known-hosts format. First connections use trust on first use; later key changes fail before sending credentials. A deliberate host-key rotation requires reviewing/removing the relevant cache entry.

No credentials or configuration output are emitted in progress events. Output filenames are validated before reads; callers cannot supply arbitrary filesystem paths.

## Windows dummy

The supplied `C:\ssh-dummy\dummy.ps1` is a CLI simulator, **not an SSH server**. Windows OpenSSH must already be installed, running and listening on `127.0.0.1:2222`; the saved username/password must be accepted by that server. Its account must be able to execute the script, and the script's enable password must match the saved SSH password exactly. A backslash before an asterisk in the supplied single-quoted EnablePassword is a literal character; it changes the password. A successful SSH login does not prove that the dummy's independently configured enable password matches. The error distinguishes an enable password rejection from a return to user mode before any password challenge.

With Mocked Data enabled, the Rust destination is unconditionally `127.0.0.1`, regardless of the selected appliance. It authenticates using the same saved credentials, requests a PTY, and executes this fixed command **on the local SSH server**:

```powershell
powershell.exe -NoProfile -File C:\ssh-dummy\dummy.ps1
```

The dummy need not be launched separately in an unrelated PowerShell window: its stdin/stdout must be attached to the SSH session for interactive challenges. No appliance or proxy is contacted. A missing OpenSSH service/script, execution-policy restriction or incorrect password produces an explicit connection/session/enable failure. The Windows dummy and a production appliance must still be validated in their own environments.

## Scope and references

The capture implements the requested SGOS configuration export. Broadcom notes that hidden keyrings remain hidden and local policy is not included by this command; it is not a disk-image backup or a guarantee that every appliance artifact is exported.

- [Broadcom: SSH configuration backup and SGOS 7.x mode transitions](https://knowledge.broadcom.com/external/article/165964)
- [Broadcom: private-key-display options, including none and reset](https://knowledge.broadcom.com/external/article/388181)
- [Broadcom: keyring display and reset workflow](https://knowledge.broadcom.com/external/article/166532/how-to-view-the-keyrings-configured-in-t.html)
- [russh client API](https://docs.rs/russh/0.63.3/russh/client/)

## Validation

Native tests run an isolated in-process SSH server on an ephemeral loopback port with synthetic credentials/configuration. They cover multi-megabyte output, fragmented challenges/prompts, delayed output, both command sequences, cleanup after rejected commands, cleanup warnings, premature EOF, mock target isolation, path traversal and storage round-trips. The fixture is test-only and is not a second runtime mock backend. Browser tests mock only Tauri IPC and check virtualized preview, switching backups, warning icons and saved credentials.

```sh
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test tests/e2e/backup-manager.spec.ts
pnpm exec tsc --noEmit
pnpm run build
```
