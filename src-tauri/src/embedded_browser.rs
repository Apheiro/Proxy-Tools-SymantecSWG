//! Child webviews are retained while hidden; only explicit close destroys a page.
//! External content gets no IPC capability. Management commands accept the main view only.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewUrl};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedPage {
    id: String,
    url: String,
    source_url: String,
    title: String,
    parent_id: Option<String>,
    group_id: String,
    loading: bool,
    loaded: bool,
    #[serde(skip)]
    auth: Option<(String, String, tauri::Url, bool)>,
    #[serde(skip)]
    form_login_attempts: u8,
}
#[derive(Default)]
struct Pages {
    entries: Vec<EmbeddedPage>,
    active: Option<String>,
    revision: u64,
    presentation: u64,
}
#[derive(Default)]
pub struct EmbeddedState {
    pages: Mutex<Pages>,
    serial: AtomicU64,
    operations: tokio::sync::Mutex<()>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    pages: Vec<EmbeddedPage>,
}
#[derive(Clone, Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Authentication {
    username: String,
    password: String,
    #[serde(default)]
    accept_invalid_certificates: bool,
}

fn trusted(view: &Webview) -> Result<(), String> {
    if view.label() != "main" {
        return Err("Only the application can manage embedded pages.".into());
    }
    Ok(())
}
fn allowed(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
}
fn local_app(app: &AppHandle, url: &tauri::Url) -> bool {
    // Never let an external child acquire an application's local origin / IPC authority.
    url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || app
            .config()
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| dev.origin() == url.origin())
}
fn snapshot(app: &AppHandle) -> Result<Snapshot, String> {
    let state = app.state::<EmbeddedState>();
    let p = state
        .pages
        .lock()
        .map_err(|_| "Embedded page state unavailable.")?;
    Ok(Snapshot {
        revision: p.revision,
        pages: p.entries.clone(),
    })
}
fn publish(app: &AppHandle) {
    if let Ok(value) = snapshot(app) {
        let _ = app.emit_to("main", "embedded:changed", value);
    }
}
fn update(app: &AppHandle, id: &str, f: impl FnOnce(&mut EmbeddedPage)) {
    let state = app.state::<EmbeddedState>();
    if let Ok(mut p) = state.pages.lock() {
        if let Some(page) = p.entries.iter_mut().find(|p| p.id == id) {
            f(page);
            p.revision += 1;
        }
    }
    publish(app);
}
fn shortcut(app: &AppHandle, id: &str, action: &str) {
    let state = app.state::<EmbeddedState>();
    let active = state
        .pages
        .lock()
        .map(|p| p.active.as_deref() == Some(id))
        .unwrap_or(false);
    if active {
        let _ = app.emit_to(
            "main",
            "embedded:shortcut",
            serde_json::json!({"id": id, "action": action}),
        );
    }
}

fn submit_management_form(app: &AppHandle, id: &str) {
    let submission = {
        let state = app.state::<EmbeddedState>();
        let Ok(mut pages) = state.pages.lock() else { return; };
        let Some(page) = pages.entries.iter_mut().find(|page| page.id == id) else { return; };
        let Some((user, password, origin, _)) = page.auth.clone() else { return; };
        // The actual document is checked again in JS before any secret is set.
        if tauri::Url::parse(&page.url).ok().is_none_or(|url| url.origin() != origin.origin()) { return; }
        if page.form_login_attempts >= 3 { None } else {
            page.form_login_attempts += 1;
            Some(crate::management_login::submission_script(&origin.origin().ascii_serialization(), &user, &password))
        }
    };
    if let Some(script) = submission {
        if let Some(view) = app.get_webview(id) {
            if view.eval(&script).is_err() {
                let _ = app.emit_to("main", "embedded:authentication-error", serde_json::json!({"id":id,"message":"Could not submit the proxy management login form."}));
            }
        }
    } else {
        let _ = app.emit_to("main", "embedded:authentication-error", serde_json::json!({"id":id,"message":"The proxy returned to its login form after 3 authentication attempts. Check your saved credentials and account permissions."}));
    }
}

fn create(
    app: AppHandle,
    url: tauri::Url,
    title: String,
    parent: Option<String>,
    auth: Option<(String, String, tauri::Url, bool)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EmbeddedPage, String>> + Send>> {
    Box::pin(async move {
        let state = app.state::<EmbeddedState>();
        let _operation = state.operations.lock().await;
        if !allowed(&url) || local_app(&app, &url) {
            return Err(
                "Only external HTTP(S) pages without embedded credentials can be opened.".into(),
            );
        }
        let existing = {
            let pages = state
                .pages
                .lock()
                .map_err(|_| "Embedded page state unavailable.")?;
            pages
                .entries
                .iter()
                .find(|page| {
                    page.source_url == url.as_str()
                        || tauri::Url::parse(&page.url).ok().as_ref() == Some(&url)
                })
                .cloned()
        };
        if let Some(page) = existing {
            let _ = app.emit_to("main", "embedded:restore", &page);
            return Ok(page);
        }
        let id = format!("embedded-{}", state.serial.fetch_add(1, Ordering::Relaxed));
        let page = {
            let mut p = state
                .pages
                .lock()
                .map_err(|_| "Embedded page state unavailable.")?;
            let related = parent
                .as_ref()
                .and_then(|id| p.entries.iter().find(|v| &v.id == id));
            let page = EmbeddedPage {
                id: id.clone(),
                url: url.to_string(),
                source_url: url.to_string(),
                title: title.chars().take(200).collect(),
                parent_id: related.map(|p| p.id.clone()),
                group_id: related
                    .map(|p| p.group_id.clone())
                    .unwrap_or_else(|| id.clone()),
                loading: true,
                loaded: false,
                auth,
                form_login_attempts: 0,
            };
            p.entries.push(page.clone());
            p.revision += 1;
            page
        };
        publish(&app);
        let _ = app.emit_to("main", "embedded:opened", &page);
        let nav_app = app.clone();
        let nav_id = id.clone();
        let load_app = app.clone();
        let load_id = id.clone();
        let title_app = app.clone();
        let title_id = id.clone();
        let popup_app = app.clone();
        let popup_id = id.clone();
        let builder = WebviewBuilder::new(
            &id,
            WebviewUrl::External(tauri::Url::parse("about:blank").map_err(|e| e.to_string())?),
        )
        .focused(false)
        .initialization_script_for_all_frames(crate::embedded_shortcuts::script(&app))
        .on_navigation(move |target| {
            if target.scheme() == "embedded-control" {
                if target.host_str() == Some("form-login") {
                    submit_management_form(&nav_app, &nav_id);
                    return false;
                }
                if target.host_str() == Some("shortcut") {
                    let action = target.path().trim_start_matches('/');
                    if ["previous", "next", "up", "down", "minimize", "close"].contains(&action) {
                        shortcut(&nav_app, &nav_id, action);
                    }
                }
                return false;
            }
            if target.as_str() == "about:blank" {
                return true;
            }
            allowed(target) && !local_app(&nav_app, target)
        })
        .on_page_load(move |view, payload| {
            if !allowed(payload.url()) {
                return;
            }
            let url = payload.url().to_string();
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            update(&load_app, &load_id, |p| {
                p.url = url;
                p.loading = loading;
                if !loading {
                    p.loaded = true;
                }
            });
            if !loading {
                let auth = load_app.state::<EmbeddedState>().pages.lock().ok()
                    .and_then(|pages| pages.entries.iter().find(|page| page.id == load_id).and_then(|page| page.auth.clone()));
                if let Some((_, _, origin, _)) = auth {
                    if payload.url().origin() == origin.origin() {
                        let _ = view.eval(&crate::management_login::detection_script(&origin.origin().ascii_serialization()));
                    }
                }
            }
        })
        .on_document_title_changed(move |_view, title| {
            if !title.trim().is_empty() {
                update(&title_app, &title_id, |p| {
                    p.title = title.chars().take(200).collect()
                });
            }
        })
        .on_new_window(move |target, _features| {
            // Tauri's Create response requires an OS window, not a child webview.
            // Route URL popups into a new retained child instead of escaping the modal.
            let app = popup_app.clone();
            let parent = popup_id.clone();
            if allowed(&target) && !local_app(&app, &target) {
                let inherited = app
                    .state::<EmbeddedState>()
                    .pages
                    .lock()
                    .ok()
                    .and_then(|p| {
                        p.entries
                            .iter()
                            .find(|v| v.id == parent)
                            .and_then(|v| v.auth.clone())
                    })
                    .filter(|(_, _, origin, _)| origin.origin() == target.origin());
                tauri::async_runtime::spawn(async move {
                    let title = target.host_str().unwrap_or("Page").to_owned();
                    match create(app.clone(), target, title, Some(parent), inherited).await {
                        Ok(_) => {}
                        Err(error) => {
                            let _ = app.emit_to("main", "embedded:error", error);
                        }
                    }
                });
            } else {
                let _ = app.emit_to(
                    "main",
                    "embedded:error",
                    "This popup has no supported HTTP(S) destination.",
                );
            }
            NewWindowResponse::Deny
        });
        let result: Result<(), String> = async {
            let previous = {
                let mut p = state
                    .pages
                    .lock()
                    .map_err(|_| "Embedded page state unavailable.")?;
                p.active = None;
                p.entries
                    .iter()
                    .filter(|p| p.id != id)
                    .map(|p| p.id.clone())
                    .collect::<Vec<_>>()
            };
            for label in previous {
                if let Some(view) = app.get_webview(&label) {
                    view.hide().map_err(|e| e.to_string())?;
                }
            }
            #[cfg(target_os = "linux")]
            crate::embedded_linux::prepare(&app).await?;
            let window = app
                .get_window("main")
                .ok_or("Application window unavailable.")?;
            let initial = window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
            let view = window
                .add_child(
                    builder,
                    tauri::LogicalPosition::new(-10000., -10000.),
                    tauri::LogicalSize::new(
                        (initial.width - 48.).max(1.),
                        (initial.height - 150.).max(1.),
                    ),
                )
                .map_err(|e| e.to_string())?;
            view.hide().map_err(|e| e.to_string())?;
            #[cfg(target_os = "linux")]
            crate::embedded_linux::attach(&view).await?;
            #[cfg(target_os = "windows")]
            {
                if let Some((user, pass, origin, allow_invalid)) = &page.auth {
                    crate::embedded_auth::install(
                        &view,
                        origin.clone(),
                        user.clone(),
                        pass.clone(),
                        *allow_invalid,
                    )
                    .map_err(|e| e.to_string())?;
                }
                windows_controls(&view, app.clone(), id.clone()).map_err(|e| e.to_string())?;
            }
            view.navigate(url).map_err(|e| e.to_string())?;
            Ok(())
        }
        .await;
        if let Err(error) = result {
            if let Some(view) = app.get_webview(&id) {
                let _ = view.close();
            }
            if let Ok(mut p) = state.pages.lock() {
                p.entries.retain(|p| p.id != id);
                p.revision += 1;
            }
            publish(&app);
            return Err(error);
        }
        publish(&app);
        Ok(page)
    })
}

#[tauri::command]
pub async fn embedded_open(
    webview: Webview,
    app: AppHandle,
    url: String,
    title: String,
    authentication: Option<Authentication>,
) -> Result<EmbeddedPage, String> {
    trusted(&webview)?;
    let url: tauri::Url = url.parse().map_err(|_| "Invalid page URL.")?;
    if authentication.is_some() && url.scheme() != "https" {
        return Err("Management credentials require HTTPS.".into());
    }
    let auth = authentication.map(|v| {
        (
            v.username,
            v.password,
            url.clone(),
            v.accept_invalid_certificates,
        )
    });
    create(app, url, title, None, auth).await
}
#[tauri::command]
pub async fn embedded_list(webview: Webview, app: AppHandle) -> Result<Snapshot, String> {
    trusted(&webview)?;
    snapshot(&app)
}
#[tauri::command]
pub async fn embedded_present(
    webview: Webview,
    app: AppHandle,
    id: String,
    bounds: Bounds,
    revision: u64,
    focus: bool,
) -> Result<(), String> {
    trusted(&webview)?;
    let state = app.state::<EmbeddedState>();
    let _operation = state.operations.lock().await;
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|v| v.is_finite())
        || bounds.width < 1.
        || bounds.height < 1.
    {
        return Err("Invalid embedded page bounds.".into());
    }
    let window = app
        .get_window("main")
        .ok_or("Application window unavailable.")?;
    let inner = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    if bounds.x < 0.
        || bounds.y < 0.
        || bounds.x + bounds.width > inner.width + 1.
        || bounds.y + bounds.height > inner.height + 1.
    {
        return Err("Embedded page must fit inside the application window.".into());
    }
    {
        let mut p = state
            .pages
            .lock()
            .map_err(|_| "Embedded page state unavailable.")?;
        if revision < p.presentation {
            return Ok(());
        }
        if !p.entries.iter().any(|p| p.id == id) {
            return Err("Embedded page was closed.".into());
        }
        p.presentation = revision;
        for page in &p.entries {
            if page.id != id {
                if let Some(v) = app.get_webview(&page.id) {
                    v.hide().map_err(|e| e.to_string())?;
                }
            }
        }
        p.active = Some(id.clone());
    }
    let view = app.get_webview(&id).ok_or("Embedded page unavailable.")?;
    #[cfg(target_os = "linux")]
    crate::embedded_linux::position(&view, bounds.x, bounds.y, bounds.width, bounds.height).await?;
    #[cfg(not(target_os = "linux"))]
    view.set_bounds(tauri::Rect {
        position: tauri::LogicalPosition::new(bounds.x, bounds.y).into(),
        size: tauri::LogicalSize::new(bounds.width, bounds.height).into(),
    })
    .map_err(|e| e.to_string())?;
    view.show().map_err(|e| e.to_string())?;
    if focus {
        view.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn embedded_hide(webview: Webview, app: AppHandle, revision: u64) -> Result<(), String> {
    trusted(&webview)?;
    let state = app.state::<EmbeddedState>();
    let _operation = state.operations.lock().await;
    {
        let mut p = state
            .pages
            .lock()
            .map_err(|_| "Embedded page state unavailable.")?;
        if revision < p.presentation {
            return Ok(());
        }
        p.presentation = revision;
        p.active = None;
        for page in &p.entries {
            if let Some(v) = app.get_webview(&page.id) {
                v.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(target_os = "linux")]
    crate::embedded_linux::inactive(&app).await?;
    if let Some(main) = app.get_webview("main") {
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn embedded_reset_session(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    trusted(&webview)?;
    let state = app.state::<EmbeddedState>();
    let _operation = state.operations.lock().await;
    let origin = {
        let pages = state.pages.lock().map_err(|_| "Embedded page state unavailable.")?;
        let page = pages.entries.iter().find(|page| page.id == id)
            .ok_or("Embedded page unavailable.")?;
        let (_, _, url, _) = page.auth.as_ref().ok_or("This is not an authenticated management page.")?;
        url.origin().ascii_serialization()
    };
    let view = app.get_webview(&id).ok_or("Embedded page unavailable.")?;
    #[cfg(target_os = "windows")]
    return crate::embedded_auth::reset_session(&view, origin).await;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (view, origin);
        Err("Automatic management session cleanup is available on Windows.".into())
    }
}
#[tauri::command]
pub async fn embedded_close(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    trusted(&webview)?;
    let state = app.state::<EmbeddedState>();
    let _operation = state.operations.lock().await;
    if let Some(view) = app.get_webview(&id) {
        if !id.starts_with("embedded-") {
            return Err("Invalid embedded page.".into());
        }
        view.close().map_err(|e| e.to_string())?;
    }
    {
        let mut p = state
            .pages
            .lock()
            .map_err(|_| "Embedded page state unavailable.")?;
        let group = p
            .entries
            .iter()
            .find(|v| v.id == id)
            .map(|v| v.group_id.clone());
        let parent = p
            .entries
            .iter()
            .find(|v| v.id == id)
            .and_then(|v| v.parent_id.clone());
        p.entries.retain(|v| v.id != id);
        if let Some(group) = group {
            let replacement = p
                .entries
                .iter()
                .find(|v| v.group_id == group)
                .map(|v| v.id.clone());
            for page in &mut p.entries {
                if page.parent_id.as_deref() == Some(&id) {
                    page.parent_id = parent.clone();
                }
                if page.group_id == id {
                    page.group_id = replacement.clone().unwrap_or_else(|| page.id.clone());
                }
            }
        }
        if p.active.as_deref() == Some(&id) {
            p.active = None;
        }
        p.revision += 1;
    }
    publish(&app);
    Ok(())
}
#[tauri::command]
pub async fn embedded_focus(webview: Webview, app: AppHandle, id: String) -> Result<(), String> {
    trusted(&webview)?;
    let state = app.state::<EmbeddedState>();
    if state
        .pages
        .lock()
        .map_err(|_| "Embedded page state unavailable.")?
        .active
        .as_deref()
        != Some(&id)
    {
        return Ok(());
    }
    app.get_webview(&id)
        .ok_or("Embedded page unavailable.")?
        .set_focus()
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn windows_controls(view: &Webview, app: AppHandle, id: String) -> tauri::Result<()> {
    view.with_webview(move |native| unsafe {
        use webview2_com::{
            AcceleratorKeyPressedEventHandler,
            Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
            },
            MoveFocusRequestedEventHandler, WindowCloseRequestedEventHandler,
        };
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
        };
        let controller = native.controller();
        let keys_app = app.clone();
        let keys_id = id.clone();
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            if let Some(args) = args {
                let mut kind = Default::default();
                args.KeyEventKind(&mut kind)?;
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                    && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                {
                    return Ok(());
                }
                let mut key = 0;
                args.VirtualKey(&mut key)?;
                let action = crate::embedded_shortcuts::action(
                    &keys_app,
                    key,
                    GetKeyState(VK_CONTROL.0 as i32) < 0,
                    GetKeyState(VK_MENU.0 as i32) < 0,
                    GetKeyState(VK_SHIFT.0 as i32) < 0,
                    GetKeyState(VK_LWIN.0 as i32) < 0 || GetKeyState(VK_RWIN.0 as i32) < 0,
                );
                if let Some(action) = action {
                    args.SetHandled(true)?;
                    shortcut(&keys_app, &keys_id, &action);
                }
            }
            Ok(())
        }));
        let mut token = 0;
        let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
        let close_app = app.clone();
        let close_id = id.clone();
        let handler = MoveFocusRequestedEventHandler::create(Box::new(move |_, args| {
            if let Some(main) = app.get_webview("main") {
                let _ = main.set_focus();
            }
            let _ = app.emit_to("main", "embedded:focus-controls", &id);
            if let Some(args) = args {
                args.SetHandled(true)?;
            }
            Ok(())
        }));
        let mut token = 0;
        let _ = controller.add_MoveFocusRequested(&handler, &mut token);
        if let Ok(core) = controller.CoreWebView2() {
            let app = close_app;
            let id = close_id;
            let handler = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                let app = app.clone();
                let id = id.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(main) = app.get_webview("main") {
                        let _ = embedded_close(main, app, id).await;
                    }
                });
                Ok(())
            }));
            let mut token = 0;
            let _ = core.add_WindowCloseRequested(&handler, &mut token);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destinations_are_external_http_without_url_credentials() {
        for url in [
            "https://example.org/page",
            "https://proxy.test:8082/",
            "http://192.0.2.10/",
        ] {
            assert!(allowed(&url.parse().unwrap()));
        }
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,test",
            "about:blank",
            "https://user:pass@example.org/",
        ] {
            assert!(!allowed(&url.parse().unwrap()));
        }
    }
    #[test]
    fn snapshot_serialization_never_exposes_authentication() {
        let page = EmbeddedPage {
            id: "embedded-1".into(),
            url: "https://example.org".into(),
            source_url: "https://example.org".into(),
            title: "Example".into(),
            parent_id: None,
            group_id: "embedded-1".into(),
            loading: false,
            loaded: true,
            auth: Some((
                "fixture-user".into(),
                "fixture-password".into(),
                "https://example.org".parse().unwrap(),
                false,
            )),
        };
        let value = serde_json::to_string(&page).unwrap();
        assert!(!value.contains("fixture-user"));
        assert!(!value.contains("fixture-password"));
        assert!(!value.contains("auth"));
    }
}
