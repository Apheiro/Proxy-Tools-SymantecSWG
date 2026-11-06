//! Persist generated reports using native filesystem APIs instead of WebView blob downloads.
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

fn report_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    if !(filename.starts_with("traffic-analysis-")
        || filename.starts_with("comparative-report-"))
        || !filename.ends_with(".pdf")
        || filename.len() > 120
        || !filename
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    {
        return Err("Invalid report filename.".into());
    }
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("traffic-analysis")
        .join(filename))
}

#[tauri::command]
pub async fn save_traffic_pdf(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.len() > 32 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
        return Err("Invalid or oversized PDF report.".into());
    }
    let path = report_path(&app, &filename)?;
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(path.parent().ok_or("Invalid report directory.")?)
            .map_err(|e| format!("Could not create report directory: {e}"))?;
        // Do not overwrite a previously exported report.
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("Could not create PDF: {e}"))?;
        if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(format!("Could not save PDF: {error}"));
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_traffic_pdf(
    app: AppHandle,
    filename: String,
    folder: bool,
) -> Result<(), String> {
    let path = report_path(&app, &filename)?;
    if !path.is_file() {
        return Err("The exported PDF no longer exists.".into());
    }
    tokio::task::spawn_blocking(move || {
        if folder {
            app.opener()
                .reveal_item_in_dir(path)
                .map_err(|e| e.to_string())
        } else {
            app.opener()
                .open_path(path.to_string_lossy(), None::<&str>)
                .map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Convert a self-contained document in-process. No WebView, browser, or shell.
#[tauri::command]
pub async fn save_html_report_pdf(
    app: AppHandle,
    filename: String,
    html: String,
) -> Result<String, String> {
    // Validate the destination before spending resources on conversion.
    report_path(&app, &filename)?;
    if html.trim().is_empty() || html.len() > 4 * 1024 * 1024 {
        return Err("HTML report is empty or exceeds the 4 MiB limit. Reduce the report scope.".into());
    }
    let bytes = tokio::task::spawn_blocking(move || {
        // No base_path/resource_root: document-local files are not authorized.
        // The remote feature is disabled in Cargo; sanitization stays enabled.
        let converter = ironpress::HtmlConverter::new()
            .page_size(ironpress::PageSize::A4)
            .margin(ironpress::Margin::uniform(36.0))
            .sanitize(true)
            .add_font(
                "ProxyToolsReport",
                include_bytes!("../../public/fonts/report/ProxyToolsReport-400.ttf").to_vec(),
            )
            .add_font(
                "ProxyToolsReportSemibold",
                include_bytes!("../../public/fonts/report/ProxyToolsReport-600.ttf").to_vec(),
            );
        let bytes = converter
            .convert(&html)
            .map_err(|e| format!("Ironpress could not render this report: {e}"))?;
        if bytes.len() > 32 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
            return Err("Ironpress produced an invalid PDF or exceeded the 32 MiB report limit.".to_string());
        }
        Ok(bytes)
    })
    .await
    .map_err(|_| "The Ironpress rendering task did not complete. Try a smaller report scope.".to_string())??;
    save_traffic_pdf(app, filename, bytes).await
}
