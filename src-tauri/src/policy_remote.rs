//! SSH operations for appliance CPL and remote files. No SFTP or local OS commands.
use crate::{
    policy_model::{self, LIMIT},
    ssh_client::{command_failed, Cli, SshConnection, SshOptions},
    ssh_target::{sgos_prompt_policy, SshTarget},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Central {
    pub host: String,
    pub port: u16,
    pub path: String,
    pub username: String,
    pub shell: String,
    pub format: String,
    pub transport: String,
    pub url: String,
}
impl Default for Central {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 22,
            path: String::new(),
            username: String::new(),
            shell: "posix".into(),
            format: "cpl".into(),
            transport: "ssh".into(),
            url: String::new(),
        }
    }
}
impl Central {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.format.as_str(), "cpl" | "project") {
            return Err("Select CPL or shared JSON format.".into());
        }
        if self.transport == "https" {
            let url =
                reqwest::Url::parse(&self.url).map_err(|_| "Enter a direct HTTPS file URL.")?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Enter an HTTPS URL without embedded credentials.".into());
            }
            return Ok(());
        }
        if self.transport != "ssh" {
            return Err("Unknown shared source transport.".into());
        }

        if self.host.trim().is_empty()
            || self.host.contains(['\r', '\n', '/', '\\', '@', ' '])
            || self.port == 0
            || self.username.trim().is_empty()
            || self.path.is_empty()
            || self.path.contains(['\r', '\n', '\0'])
        {
            return Err(
                "Configure the central SSH host, port, account and absolute file path.".into(),
            );
        }
        if !matches!(self.shell.as_str(), "posix" | "powershell") {
            return Err("Select POSIX or PowerShell.".into());
        }
        if self.shell == "posix" && !self.path.starts_with('/') {
            return Err("POSIX paths must be absolute.".into());
        }
        if self.shell == "powershell"
            && !(self.path.as_bytes().get(1) == Some(&b':') || self.path.starts_with("\\\\"))
        {
            return Err("PowerShell paths must be absolute.".into());
        }
        Ok(())
    }
}
async fn connect(
    root: &Path,
    host: &str,
    port: u16,
    user: &str,
    password: &str,
    pty: bool,
) -> Result<SshConnection, String> {
    let mut options = SshOptions::new(host, port, root.join("backup-ssh-known-hosts"));
    if !pty {
        options.pty = None;
    }
    let mut connection = SshConnection::connect(options).await?;
    connection.authenticate(user, password, None).await?;
    Ok(connection)
}
pub(crate) async fn appliance(
    root: &Path,
    address: &str,
    mocked: bool,
    user: &str,
    password: &str,
    expected: Option<&str>,
    content: Option<&str>,
) -> Result<String, String> {
    let target = SshTarget::appliance(address, mocked)?;
    let connection = connect(root, &target.host, target.port, user, password, true).await?;
    let result=async {
  let mut cli=connection.open_cli(target.startup,sgos_prompt_policy()).await?;
  cli.enable(password).await?; cli.command(None,"config terminal").await?;
  let original=cli.capture("show sources policy local", LIMIT).await?;
  if let Some(expected)=expected {
   if policy_model::hash(&policy_model::canonical(&original))!=expected {return Err("Local Policy changed since inspection. This proxy was not modified; rescan and compare.".into());}
  }
  if let Some(content)=content {
   if !policy_model::health(&original).healthy {return Err("Current policy is unreadable; automatic replacement is disabled.".into());}
   install_policy(&mut cli,content).await?;
   let saved=cli.capture("show sources policy local", LIMIT).await?;
   if policy_model::canonical(&saved)!=policy_model::canonical(content) {return Err("Readback differs from the requested CPL. State is uncertain; inspect this proxy manually.".into());}
   Ok(saved)
  } else {Ok(original)}
 }.await;
    let _ = connection.disconnect().await;
    result
}
async fn install_policy(cli: &mut Cli, content: &str) -> Result<(), String> {
    let delimiter = policy_model::delimiter(content);
    let normalized = content.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let enter = if normalized.ends_with('\n') { "" } else { "\r" };
    let wire = format!("{}{enter}{delimiter}\r", normalized.replace('\n', "\r"));
    let output = cli
        .upload_capture(
            &format!("inline policy local {delimiter}"),
            wire.as_bytes(),
            LIMIT + 65536,
        )
        .await?;
    if command_failed(&output)
        || output
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .is_none_or(|l| !l.trim().eq_ignore_ascii_case("ok"))
    {
        return Err("Policy compiler did not confirm success. Rescan before retrying.".into());
    }
    Ok(())
}
fn quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}
pub(crate) fn script(
    config: &Central,
    original: Option<&str>,
    desired: Option<&str>,
) -> Result<(String, String), String> {
    config.validate()?;
    let content = desired.unwrap_or("");
    if config.shell == "posix" {
        let path = quote(&config.path);
        if let Some(original) = original {
            let id = crate::backup_store::new_id("policy");
            let expected = STANDARD.encode(original);
            let desired = STANDARD.encode(content);
            Ok((
                "sh -s".into(),
                format!(
                    r#"set -eu
umask 077
p={path}
[ -f "$p" ] && [ ! -L "$p" ] || exit 75
lock="$p.proxytools.lock"
mkdir "$lock" 2>/dev/null || exit 73
tmp="$lock/replacement-{id}"
expected="$lock/original"
trap 'rm -f "$tmp" "$expected"; rmdir "$lock"' EXIT
printf '%s' '{expected}' | base64 -d > "$expected"
cmp -s "$p" "$expected" || exit 74
cp -p "$p" "$tmp"
printf '%s' '{desired}' | base64 -d > "$tmp"
cmp -s "$p" "$expected" || exit 74
mv -f "$tmp" "$p"
cat "$p"
"#
                ),
            ))
        } else {
            Ok((
                "sh -s".into(),
                format!(
                    "set -eu\np={path}\n[ -f \"$p\" ] && [ ! -L \"$p\" ] || exit 75\ncat \"$p\"\n"
                ),
            ))
        }
    } else {
        let path = STANDARD.encode(config.path.as_bytes());
        let start=format!("$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{path}')); if ((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint) {{exit 75}}; ");
        let body = if let Some(original) = original {
            let desired = STANDARD.encode(content);
            let expected = policy_model::hash(original);
            let id = crate::backup_store::new_id("policy");
            format!("$l=$null; $tmp=$p+'.proxytools-{id}'; try {{ try {{$l=[IO.File]::Open($p+'.proxytools.lock',[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)}} catch {{exit 73}}; $sha=[Security.Cryptography.SHA256]::Create(); $check={{([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($p)))).Replace('-','').ToLowerInvariant()}}; if ((& $check) -ne '{expected}') {{exit 74}}; [IO.File]::WriteAllBytes($tmp,[Convert]::FromBase64String('{desired}')); if ((& $check) -ne '{expected}') {{exit 74}}; [IO.File]::Replace($tmp,$p,$null); $b=[IO.File]::ReadAllBytes($p); [Console]::OpenStandardOutput().Write($b,0,$b.Length) }} finally {{if (Test-Path -LiteralPath $tmp) {{Remove-Item -LiteralPath $tmp -Force}}; if ($null -ne $l) {{$l.Dispose(); Remove-Item -LiteralPath ($p+'.proxytools.lock') -Force}}}}")
        } else {
            "$b=[IO.File]::ReadAllBytes($p); [Console]::OpenStandardOutput().Write($b,0,$b.Length)"
                .into()
        };
        Ok((
            "powershell.exe -NoLogo -NoProfile -NonInteractive -Command -".into(),
            format!("{start}{body}\n"),
        ))
    }
}
pub(crate) async fn central(
    root: &Path,
    config: &Central,
    mocked: bool,
    password: &str,
    original: Option<&str>,
    desired: Option<&str>,
) -> Result<String, String> {
    config.validate()?;
    if config.transport == "https" {
        if desired.is_some() {
            return Err("Web sources are read-only. Export the shared document and upload it through the hosting service.".into());
        }
        if mocked {
            return Err("Remote web requests are disabled in Mocked Data. Import a local shared document or use localhost SSH.".into());
        }
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::limited(5))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| "Cannot initialize HTTPS source client.")?;
        let mut response = client.get(&config.url).send().await.map_err(|_| {
            "Could not fetch shared source. A direct file download URL is required."
        })?;
        if !response.status().is_success() {
            return Err(format!("Shared source returned HTTP {}. Private Microsoft 365 libraries require their own authenticated integration.", response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Shared source download failed.")?
        {
            if bytes.len().saturating_add(chunk.len()) > LIMIT {
                return Err("Shared document exceeds 4 MiB.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        return String::from_utf8(bytes).map_err(|_| "Shared document must be UTF-8.".into());
    }
    let (command, script) = script(config, original, desired)?;
    let host = if mocked { "127.0.0.1" } else { &config.host };
    let port = if mocked { 2222 } else { config.port };
    let connection = connect(root, host, port, &config.username, password, false).await?;
    let output = connection.execute(&command, script.as_bytes(), LIMIT).await;
    let _ = connection.disconnect().await;
    let output = String::from_utf8(output?)
        .map_err(|_| "Remote file is not UTF-8. No lossy conversion was applied.".to_string())?;
    if let Some(desired) = desired {
        if output != desired {
            return Err("Saved file readback differs; reload and inspect the server.".into());
        }
    }
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn posix_scripts_preserve_bytes_and_reject_stale_edits() {
        use std::{
            fs,
            io::Write,
            process::{Command, Stdio},
        };
        let root = std::env::temp_dir().join(format!(
            "policy-script-{}",
            crate::backup_store::new_id("policy")
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("policy's file.cpl");
        let old = "; original\r\n<Proxy>\r\nallow\r\n";
        let new = "; original\r\n<Proxy>\r\ndeny\r\n";
        fs::write(&path, old).unwrap();
        let config = Central {
            host: "example".into(),
            username: "test".into(),
            path: path.to_str().unwrap().into(),
            ..Default::default()
        };
        let run = |original: Option<&str>, desired: Option<&str>| {
            let (_, script) = script(&config, original, desired).unwrap();
            let mut c = Command::new("sh")
                .arg("-s")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            c.stdin
                .take()
                .unwrap()
                .write_all(script.as_bytes())
                .unwrap();
            c.wait_with_output().unwrap()
        };
        assert_eq!(run(None, None).stdout, old.as_bytes());
        let out = run(Some(old), Some(new));
        assert!(out.status.success());
        assert_eq!(out.stdout, new.as_bytes());
        assert_eq!(fs::read(&path).unwrap(), new.as_bytes());
        let out = run(Some(old), Some("<Proxy>\nallow"));
        assert_eq!(out.status.code(), Some(74));
        assert_eq!(fs::read(&path).unwrap(), new.as_bytes());
        assert!(!path.with_extension("cpl.proxytools.lock").exists());
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use crate::backup_manager::ssh_tests::{fixture_connection, TEST_PASSWORD};
    #[tokio::test]
    async fn inline_upload_crosses_windows_preserves_lines_and_captures_complete_readback() {
        let (mut connection, _, root, _) = fixture_connection("small-window").await;
        connection
            .authenticate("test", TEST_PASSWORD, None)
            .await
            .unwrap();
        let mut cli = connection
            .open_cli(None, sgos_prompt_policy())
            .await
            .unwrap();
        cli.enable(TEST_PASSWORD).await.unwrap();
        cli.command(None, "config terminal").await.unwrap();
        let old = cli
            .capture("show sources policy local", LIMIT)
            .await
            .unwrap();
        assert!(old.contains("; original"));
        let text = format!(
            "<Proxy>\n{}url.domain=last.example deny\n",
            "; preserve this exact line\n".repeat(8000)
        );
        tokio::time::timeout(
            std::time::Duration::from_secs(30),
            install_policy(&mut cli, &text),
        )
        .await
        .unwrap()
        .unwrap();
        let saved = cli
            .capture("show sources policy local", LIMIT)
            .await
            .unwrap();
        assert_eq!(
            policy_model::canonical(&saved),
            policy_model::canonical(&text)
        );
        assert!(saved.len() > 200_000);
        connection.disconnect().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn compile_failure_is_not_success_and_old_policy_remains() {
        let (mut connection, _, root, _) = fixture_connection("policy-compile").await;
        connection
            .authenticate("test", TEST_PASSWORD, None)
            .await
            .unwrap();
        let mut cli = connection
            .open_cli(None, sgos_prompt_policy())
            .await
            .unwrap();
        cli.enable(TEST_PASSWORD).await.unwrap();
        cli.command(None, "config terminal").await.unwrap();
        let old = cli
            .capture("show sources policy local", LIMIT)
            .await
            .unwrap();
        assert!(
            install_policy(&mut cli, "<Proxy>\ninvalid.property=foo deny\n")
                .await
                .is_err()
        );
        assert_eq!(
            cli.capture("show sources policy local", LIMIT)
                .await
                .unwrap(),
            old
        );
        connection.disconnect().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod file_transport_tests {
    use super::*;
    #[tokio::test]
    async fn ssh_script_streams_complete_utf8_and_reports_conflicts() {
        let (mut connection, _, root, _) =
            crate::backup_manager::ssh_tests::fixture_connection("").await;
        connection
            .authenticate(
                "test",
                crate::backup_manager::ssh_tests::TEST_PASSWORD,
                None,
            )
            .await
            .unwrap();
        let path = root.join("remote.cpl");
        let original = format!("<Proxy>\r\n{}allow\r\n", "; preserved ñ\r\n".repeat(10000));
        std::fs::write(&path, &original).unwrap();
        let config = Central {
            host: "localhost".into(),
            username: "test".into(),
            path: path.to_str().unwrap().into(),
            ..Default::default()
        };
        let (cmd, input) = script(&config, None, None).unwrap();
        let bytes = connection
            .execute(&cmd, input.as_bytes(), LIMIT)
            .await
            .unwrap();
        assert_eq!(bytes, original.as_bytes());
        let changed = original.replace("allow", "deny");
        let (cmd, input) = script(&config, Some(&original), Some(&changed)).unwrap();
        assert_eq!(
            connection
                .execute(&cmd, input.as_bytes(), LIMIT)
                .await
                .unwrap(),
            changed.as_bytes()
        );
        let (cmd, input) = script(&config, Some(&original), Some("<Proxy>\nallow\n")).unwrap();
        assert!(connection
            .execute(&cmd, input.as_bytes(), LIMIT)
            .await
            .unwrap_err()
            .contains("changed"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), changed);
        connection.disconnect().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
