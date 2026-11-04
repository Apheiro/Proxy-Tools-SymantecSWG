//! Save literal PAC/WPAD text with native filesystem confirmation.
use std::io::{ErrorKind, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPacFile {
    filename: String,
    path: String,
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| format!("Could not locate your Downloads folder: {error}"))?;
    if !directory.is_absolute() {
        return Err("The system did not provide an absolute Downloads folder path.".into());
    }
    if directory.to_str().is_none() {
        return Err("The system Downloads path cannot be represented as UTF-8.".into());
    }
    Ok(directory)
}

fn safe_filename(input: &str) -> String {
    // A portable ASCII basename: no path separators, control characters or Windows devices.
    let cleaned: String = input
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || "-_.".contains(character) {
                character
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches(|character| character == '.' || character == '-');
    let (stem, extension) = match cleaned.rsplit_once('.') {
        Some((stem, extension)) if extension.eq_ignore_ascii_case("pac") => (stem, "pac"),
        Some((stem, extension)) if extension.eq_ignore_ascii_case("dat") => (stem, "dat"),
        _ => (cleaned, "pac"),
    };
    let mut stem: String = stem
        .trim_matches(|character| character == '.' || character == '-')
        .chars()
        .take(100)
        .collect();
    if stem.is_empty() {
        stem = "wpad".into();
    }
    let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && matches!(device.as_bytes()[3], b'1'..=b'9'))
    {
        stem = format!("wpad-{stem}");
    }
    format!("{stem}.{extension}")
}

// std::fs::File::drop cannot report close errors. Transfer ownership once so
// success is acknowledged only after the platform close operation also succeeds.
#[cfg(unix)]
fn close_file(file: std::fs::File) -> std::io::Result<()> {
    use std::os::fd::IntoRawFd;
    unsafe extern "C" {
        fn close(fd: std::os::raw::c_int) -> std::os::raw::c_int;
    }
    // SAFETY: into_raw_fd transfers our live, exclusively owned descriptor.
    // Do not retry close after EINTR: on Linux the descriptor may already be released.
    if unsafe { close(file.into_raw_fd()) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn close_file(file: std::fs::File) -> std::io::Result<()> {
    use std::os::windows::io::IntoRawHandle;
    // SAFETY: into_raw_handle transfers ownership of this valid file handle.
    if unsafe { windows_sys::Win32::Foundation::CloseHandle(file.into_raw_handle()) } != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[tauri::command]
pub async fn save_pac_text(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<SavedPacFile, String> {
    let directory = downloads_dir(&app)?;
    let filename = safe_filename(&filename);
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "Could not prepare Downloads folder {}: {error}",
                directory.display()
            )
        })?;
        let (stem, extension) = filename
            .rsplit_once('.')
            .ok_or("Invalid PAC/WPAD filename.")?;
        for suffix in 0..10_000 {
            let candidate = if suffix == 0 {
                filename.clone()
            } else {
                format!("{stem}-{suffix}.{extension}")
            };
            let path = directory.join(&candidate);
            // Atomic reservation: even simultaneous exports never replace an existing file.
            let mut file = match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(file) => file,
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(format!(
                        "Could not create PAC/WPAD file {}: {error}",
                        path.display()
                    ))
                }
            };
            // String bytes are UTF-8 verbatim, including BOM, CRLF/LF/CR and empty content.
            let written = file
                .write_all(content.as_bytes())
                .and_then(|_| file.sync_all());
            let closed = close_file(file);
            if written.is_err() || closed.is_err() {
                let cause = written
                    .err()
                    .map(|error| format!("write or sync failed: {error}"))
                    .into_iter()
                    .chain(closed.err().map(|error| format!("close failed: {error}")))
                    .collect::<Vec<_>>()
                    .join("; ");
                let cleanup = std::fs::remove_file(&path)
                    .err()
                    .map(|cleanup| format!(" Could not remove the incomplete file: {cleanup}"))
                    .unwrap_or_default();
                return Err(format!(
                    "Could not save PAC/WPAD file {}: {cause}.{cleanup}",
                    path.display()
                ));
            }
            return Ok(SavedPacFile {
                filename: candidate,
                path: path.to_string_lossy().into_owned(),
            });
        }
        Err("Could not find an unused PAC/WPAD filename in Downloads.".into())
    })
    .await
    .map_err(|error| format!("PAC/WPAD save task failed: {error}"))?
}

#[tauri::command]
pub async fn reveal_pac_export(app: AppHandle, filename: String) -> Result<(), String> {
    // Accept only a portable basename in the system Downloads folder, never an arbitrary path.
    if filename.len() > 150
        || !filename
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        || !(filename.ends_with(".pac") || filename.ends_with(".dat"))
        || filename.starts_with('.')
    {
        return Err("Invalid PAC/WPAD export filename.".into());
    }
    let directory = downloads_dir(&app)?;
    let path = directory.join(filename);
    tokio::task::spawn_blocking(move || {
        if !path.is_file() {
            return Err(format!("The exported PAC/WPAD file no longer exists: {}", path.display()));
        }
        if let Err(reveal_error) = app.opener().reveal_item_in_dir(&path) {
            // Some Linux file managers cannot select a file; open its real parent folder instead.
            app.opener().open_path(directory.to_string_lossy(), None::<&str>)
                .map_err(|open_error| format!("Could not reveal the saved file: {reveal_error}. Could not open its Downloads folder: {open_error}"))?;
        }
        Ok(())
    }).await.map_err(|error| format!("Could not open the PAC/WPAD export location: {error}"))?
}
