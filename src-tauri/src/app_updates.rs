//! GitHub release discovery and verified downloads. Never replaces the running app.
use reqwest::{
    header::{HeaderValue, ACCEPT, AUTHORIZATION},
    Client, Response, StatusCode,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REPOSITORY: &str = "https://api.github.com/repos/Apheiro/Proxy-Tools-SymantecSWG";
const TOKEN_TARGET: &str = "proxytools/github-release-token";
const MAX_ASSET: u64 = 512 * 1024 * 1024;

#[derive(Default)]
pub struct UpdateState {
    available: Mutex<[Option<AvailableUpdate>; 2]>,
    downloading: AtomicBool,
}
#[derive(Clone, Deserialize)]
struct Asset {
    id: u64,
    name: String,
    size: u64,
    state: String,
    digest: Option<String>,
}
#[derive(Deserialize)]
struct Release {
    id: u64,
    tag_name: String,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    id: u64,
    version: String,
    current_version: String,
    notes: String,
    filename: String,
    bytes: u64,
    #[serde(skip)]
    asset_id: u64,
    #[serde(skip)]
    sha256: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    filename: String,
    path: String,
    current_executable: String,
}

fn validate_token(token: &str) -> Result<(), String> {
    if token.len() > 4096 || token.is_empty() || !token.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err("Enter a valid GitHub token without whitespace.".into());
    }
    HeaderValue::from_str(&format!("Bearer {token}"))
        .map(|_| ())
        .map_err(|_| "Invalid GitHub token.".into())
}
fn read_token() -> Result<Option<String>, String> {
    crate::credential_vault::read(TOKEN_TARGET)?
        .map(|mut bytes| {
            let result = String::from_utf8(bytes.clone())
                .map_err(|_| "Stored GitHub token is invalid.".into());
            bytes.fill(0);
            result
        })
        .transpose()
}
fn token_for(mocked: bool, mock_token: Option<String>) -> Result<Option<String>, String> {
    let token = if mocked { mock_token } else { read_token()? };
    let token = token.filter(|value| !value.is_empty());
    if let Some(token) = &token {
        validate_token(token)?;
    }
    Ok(token)
}
#[tauri::command]
pub fn has_update_token() -> Result<bool, String> {
    Ok(read_token()?.is_some())
}
#[tauri::command]
pub fn save_update_token(token: String) -> Result<(), String> {
    let token = token.trim();
    validate_token(token)?;
    crate::credential_vault::write(TOKEN_TARGET, token.as_bytes().to_vec(), "GitHub")
}
#[tauri::command]
pub fn delete_update_token() -> Result<(), String> {
    crate::credential_vault::delete(TOKEN_TARGET)
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("ProxyTools-release-checker")
        // Never route repository credentials through an appliance proxy.
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "Could not initialize update connection.".into())
}
fn request(
    client: &Client,
    url: &str,
    token: Option<&str>,
    accept: &str,
) -> reqwest::RequestBuilder {
    let mut request = client
        .get(url)
        .header(ACCEPT, accept)
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    request
}
fn status_error(status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED => "GitHub rejected the token. Update it in Settings.".into(),
        StatusCode::FORBIDDEN => "GitHub denied access or its API rate limit was reached. Check token permissions and retry later.".into(),
        StatusCode::NOT_FOUND => "No accessible release was found. Private repositories require a GitHub token with Contents: Read.".into(),
        _ => format!("GitHub update request failed (HTTP {}).", status.as_u16()),
    }
}
async fn checked(response: Response) -> Result<Response, String> {
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }
    Ok(response)
}
async fn release_from_response(response: Response) -> Result<Release, String> {
    let mut response = checked(response).await?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read GitHub release metadata.")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("GitHub release metadata is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "GitHub returned invalid release metadata.".into())
}
fn select_update(release: Release, current: &str) -> Result<Option<AvailableUpdate>, String> {
    if release.draft || release.prerelease {
        return Ok(None);
    }
    let version = Version::parse(
        release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name),
    )
    .map_err(|_| "Release tag is not a valid application version.")?;
    let current_version = Version::parse(current).map_err(|_| "Current app version is invalid.")?;
    if !version.pre.is_empty() || version <= current_version {
        return Ok(None);
    }
    let filename = format!("proxytools-v{version}-windows-x64.exe");
    let Some(asset) = release
        .assets
        .into_iter()
        .find(|asset| asset.name == filename && asset.state == "uploaded")
    else {
        // Release Please publishes before the Windows build completes.
        return Ok(None);
    };
    if asset.size < 2 || asset.size > MAX_ASSET {
        return Err("Release executable has an invalid size.".into());
    }
    let hash = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or(
            "Release executable has no valid SHA-256 digest yet. Retry after the build finishes.",
        )?
        .to_ascii_lowercase();
    Ok(Some(AvailableUpdate {
        id: release.id,
        version: version.to_string(),
        current_version: current.into(),
        notes: release.body.unwrap_or_default(),
        filename,
        bytes: asset.size,
        asset_id: asset.id,
        sha256: hash,
    }))
}
#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    mocked: bool,
    mock_token: Option<String>,
) -> Result<Option<AvailableUpdate>, String> {
    let token = token_for(mocked, mock_token)?;
    let client = client()?;
    let response = request(
        &client,
        &format!("{REPOSITORY}/releases/latest"),
        token.as_deref(),
        "application/vnd.github+json",
    )
    .timeout(Duration::from_secs(20))
    .send()
    .await
    .map_err(|_| "Could not connect to GitHub to check updates.")?;
    let update = select_update(
        release_from_response(response).await?,
        &app.package_info().version.to_string(),
    )?;
    state
        .available
        .lock()
        .map_err(|_| "Update state is unavailable.")?[usize::from(mocked)] = update.clone();
    Ok(update)
}
fn allowed_download(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com")
        )
}
async fn asset_response(
    client: &Client,
    url: &str,
    token: Option<&str>,
) -> Result<Response, String> {
    let response = request(client, url, token, "application/octet-stream")
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|_| "Could not download the release executable.")?;
    if response.status().is_redirection() {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| reqwest::Url::parse(value).ok())
            .filter(allowed_download)
            .ok_or("GitHub returned an unsupported download destination.")?;
        // Redirected asset requests must not carry the GitHub token.
        let response = client
            .get(location)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(|_| "Could not download the release executable.")?;
        checked(response).await
    } else {
        checked(response).await
    }
}
async fn verify_file(path: &Path, update: &AvailableUpdate) -> Result<(), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Could not verify the downloaded executable.")?;
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut first = Vec::new();
    // Keep this buffer out of the async future itself. Tauri's command bridge
    // moves nested futures; an inline 64 KiB array needlessly increases stack use.
    let mut buffer = vec![0_u8; 65536];
    loop {
        let count = file
            .read(&mut buffer)
            .await
            .map_err(|_| "Could not verify the downloaded executable.")?;
        if count == 0 {
            break;
        }
        if first.len() < 2 {
            first.extend_from_slice(&buffer[..count.min(2 - first.len())]);
        }
        bytes += count as u64;
        hash.update(&buffer[..count]);
    }
    if bytes != update.bytes || first != b"MZ" || format!("{:x}", hash.finalize()) != update.sha256
    {
        return Err("Downloaded executable failed size or SHA-256 verification. It has not been marked ready.".into());
    }
    Ok(())
}
struct DownloadGuard<'a>(&'a AtomicBool);
impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
/// Best-effort, bounded diagnostics. Only fixed stage names and byte counts are recorded.
/// No request URLs, authorization headers, tokens or release-note content enter this log.
struct DownloadTrace {
    path: PathBuf,
}
impl DownloadTrace {
    fn new(root: &Path) -> Self {
        Self {
            path: root.join("updater.log"),
        }
    }
    fn record(&self, stage: &str, bytes: u64) {
        use std::io::Write;
        // Retain at most two 256 KiB files across repeated update attempts.
        if std::fs::metadata(&self.path).is_ok_and(|m| m.len() >= 256 * 1024) {
            let previous = self.path.with_extension("previous.log");
            let _ = std::fs::remove_file(&previous);
            let _ = std::fs::rename(&self.path, previous);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = writeln!(
                file,
                "{} stage={stage} bytes={bytes}",
                chrono::Utc::now().to_rfc3339()
            );
            let _ = file.sync_data();
        }
    }
}
fn trace_stage(trace: Option<&DownloadTrace>, stage: &str, bytes: u64) {
    if let Some(trace) = trace {
        trace.record(stage, bytes);
    }
}
async fn save_download(
    mut response: Response,
    root: &Path,
    update: &AvailableUpdate,
    trace: Option<&DownloadTrace>,
) -> Result<PathBuf, String> {
    let output = root.join(&update.filename);
    if output.exists() {
        trace_stage(trace, "existing-file-verification-started", 0);
        verify_file(&output, update).await?;
        trace_stage(trace, "existing-file-verification-complete", update.bytes);
        return Ok(output);
    }
    let partial = root.join(format!(
        "{}.{}.part",
        update.filename,
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let result = async {
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&partial)
            .await
            .map_err(|_| "Could not create the update download.")?;
        trace_stage(trace, "partial-file-created", 0);
        let mut bytes = 0_u64;
        let mut checkpoint = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Release download was interrupted. Retry the download.")?
        {
            bytes += chunk.len() as u64;
            if bytes > update.bytes || bytes > MAX_ASSET {
                return Err("Release download exceeds the expected size.".to_string());
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| "Could not save the update download.")?;
            if checkpoint == 0 || bytes.saturating_sub(checkpoint) >= 8 * 1024 * 1024 {
                trace_stage(trace, "download-progress", bytes);
                checkpoint = bytes;
            }
        }
        file.flush()
            .await
            .map_err(|_| "Could not finish the update download.")?;
        file.sync_all()
            .await
            .map_err(|_| "Could not finish the update download.")?;
        drop(file);
        trace_stage(trace, "download-complete", bytes);
        trace_stage(trace, "verification-started", bytes);
        verify_file(&partial, update).await?;
        trace_stage(trace, "verification-complete", bytes);
        // Preserve existing complete downloads; never overwrite a running executable.
        if output.exists() {
            return Err("An update file already exists. Move it before retrying.".into());
        }
        trace_stage(trace, "publish-started", bytes);
        tokio::fs::rename(&partial, &output)
            .await
            .map_err(|_| "Could not finalize the update download.")?;
        trace_stage(trace, "publish-complete", bytes);
        Ok(output)
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(partial).await;
    }
    result
}
fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    let root = crate::check_cache_dir(app)
        .map_err(|_| "Could not resolve application cache.")?
        .join("updates");
    std::fs::create_dir_all(&root).map_err(|_| "Could not create update download directory.")?;
    Ok(root)
}
#[tauri::command]
pub async fn download_app_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    release_id: u64,
    mocked: bool,
    mock_token: Option<String>,
) -> Result<DownloadedUpdate, String> {
    if state
        .downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("An update download is already running.".into());
    }
    let _guard = DownloadGuard(&state.downloading);
    let update = state
        .available
        .lock()
        .map_err(|_| "Update state is unavailable.")?[usize::from(mocked)]
    .clone()
    .filter(|value| value.id == release_id)
    .ok_or("Update information changed. Check for updates again.")?;
    let root = directory(&app)?;
    let trace = DownloadTrace::new(&root);
    trace.record("download-request-received", 0);
    let result = async {
        trace.record("credentials-read-started", 0);
        let token = token_for(mocked, mock_token)?;
        trace.record("credentials-read-complete", 0);
        let output = root.join(&update.filename);
        let path = if output.exists() {
            trace.record("existing-file-verification-started", 0);
            verify_file(&output, &update).await?;
            trace.record("existing-file-verification-complete", update.bytes);
            output
        } else {
            let client = client()?;
            trace.record("asset-request-started", 0);
            let response = asset_response(
                &client,
                &format!("{REPOSITORY}/releases/assets/{}", update.asset_id),
                token.as_deref(),
            )
            .await?;
            trace.record("asset-response-received", 0);
            save_download(response, &root, &update, Some(&trace)).await?
        };
        Ok(DownloadedUpdate {
            filename: update.filename,
            path: path.display().to_string(),
            current_executable: std::env::current_exe()
                .map_err(|_| "Could not locate the running executable.")?
                .display()
                .to_string(),
        })
    }
    .await;
    trace.record(
        if result.is_ok() {
            "download-ready"
        } else {
            "download-failed"
        },
        0,
    );
    result
}
#[tauri::command]
pub async fn open_update_folder(app: AppHandle) -> Result<(), String> {
    let path = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|_| "Could not open the update folder.".to_string())
    })
    .await
    .map_err(|_| "Could not open the update folder.".to_string())?
}

#[cfg(test)]
#[path = "app_updates_tests.rs"]
mod tests;
