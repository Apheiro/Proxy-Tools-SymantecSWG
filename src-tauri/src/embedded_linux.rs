//! Tauri's Linux runtime packs child views into its default GtkBox. Reuse the
//! actual WebKit widgets in an Overlay/Fixed layer so the app is not split vertically.
//! No webview is recreated and no page source/security policy is modified.
use gtk::prelude::*;
use tauri::{AppHandle, Manager, Webview};
const OVERLAY: &str = "embedded-page-overlay";
const SURFACES: &str = "embedded-page-surfaces";

fn layers(root: &gtk::Box) -> Option<(gtk::Overlay, gtk::Fixed)> {
    let overlay = root
        .children()
        .into_iter()
        .find(|v| v.widget_name() == OVERLAY)?
        .downcast::<gtk::Overlay>()
        .ok()?;
    let fixed = overlay
        .children()
        .into_iter()
        .find(|v| v.widget_name() == SURFACES)?
        .downcast::<gtk::Fixed>()
        .ok()?;
    Some((overlay, fixed))
}

// Clip native INPUT separately from drawing. GTK can retain a larger backing
// window even when the WebKit page already looks correctly positioned.
fn constrain_input(overlay: &gtk::Overlay, fixed: &gtk::Fixed) {
    let Some(main_window) = overlay.child().and_then(|widget| widget.window()) else {
        return;
    };
    let (_, main_x, main_y) = main_window.origin();
    let backdrop_window = overlay.window();
    let active = fixed.is_sensitive();
    let x = fixed.margin_start();
    let y = fixed.margin_top();
    let width = fixed.width_request().max(0);
    let height = fixed.height_request().max(0);
    let apply = |window: gtk::gdk::Window, enabled: bool| {
        // Never alter the application/titlebar's shared native input window.
        if window == main_window || backdrop_window.as_ref() == Some(&window) {
            return;
        }
        let region = if enabled {
            let (_, origin_x, origin_y) = window.origin();
            gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(
                main_x + x - origin_x,
                main_y + y - origin_y,
                width,
                height,
            ))
        } else {
            gtk::cairo::Region::create()
        };
        window.input_shape_combine_region(&region, 0, 0);
    };
    let surface_window = fixed.window();
    if let Some(window) = surface_window.clone() {
        apply(window, active);
    }
    for child in fixed.children() {
        if let Some(window) = child.window() {
            if surface_window.as_ref() == Some(&window) {
                continue;
            }
            apply(window, active && child.is_visible());
        }
    }
}

pub async fn prepare(app: &AppHandle) -> Result<(), String> {
    let main = app.get_webview("main").ok_or("Main webview unavailable.")?;
    let window = app.get_window("main").ok_or("Main window unavailable.")?;
    let (send, receive) = tokio::sync::oneshot::channel();
    main.with_webview(move |native| {
        let result = (|| -> Result<(), String> {
            let root = window.default_vbox().map_err(|e| e.to_string())?;
            if let Some((overlay, fixed)) = layers(&root) {
                overlay.set_overlay_pass_through(&fixed, true);
                fixed.set_sensitive(false);
                constrain_input(&overlay, &fixed);
                return Ok(());
            }
            let content = native.inner();
            let parent = content
                .parent()
                .ok_or("Main WebKit parent unavailable.")?
                .downcast::<gtk::Container>()
                .map_err(|_| "Main WebKit container unavailable.")?;
            let overlay = gtk::Overlay::new();
            overlay.set_widget_name(OVERLAY);
            overlay.set_hexpand(true);
            overlay.set_vexpand(true);
            let fixed = gtk::Fixed::new();
            fixed.set_widget_name(SURFACES);
            fixed.set_halign(gtk::Align::Start);
            fixed.set_valign(gtk::Align::Start);
            parent.remove(&content);
            overlay.add(&content);
            overlay.add_overlay(&fixed);
            fixed.set_sensitive(false);
            let weak_overlay = overlay.downgrade();
            fixed.connect_size_allocate(move |fixed, _| {
                if let Some(overlay) = weak_overlay.upgrade() {
                    constrain_input(&overlay, fixed);
                }
            });
            overlay.set_overlay_pass_through(&fixed, true);
            root.pack_start(&overlay, true, true, 0);
            overlay.show_all();
            Ok(())
        })();
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "GTK page layout initialization interrupted.".to_string())?
}

pub async fn attach(view: &Webview) -> Result<(), String> {
    let window = view.window();
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| {
        let result = (|| -> Result<(), String> {
            let root = window.default_vbox().map_err(|e| e.to_string())?;
            let (_, fixed) = layers(&root).ok_or("Embedded GTK layout unavailable.")?;
            let content = native.inner();
            content.hide();
            let parent = content
                .parent()
                .ok_or("Child WebKit parent unavailable.")?
                .downcast::<gtk::Container>()
                .map_err(|_| "Child WebKit container unavailable.")?;
            parent.remove(&content);
            fixed.put(&content, 0, 0);
            let weak_fixed = fixed.downgrade();
            content.connect_size_allocate(move |_, _| {
                if let Some(fixed) = weak_fixed.upgrade() {
                    if let Some(overlay) = fixed
                        .parent()
                        .and_then(|parent| parent.downcast::<gtk::Overlay>().ok())
                    {
                        constrain_input(&overlay, &fixed);
                    }
                }
            });
            let weak_fixed = fixed.downgrade();
            content.connect_map(move |_| {
                if let Some(fixed) = weak_fixed.upgrade() {
                    if let Some(overlay) = fixed
                        .parent()
                        .and_then(|parent| parent.downcast::<gtk::Overlay>().ok())
                    {
                        constrain_input(&overlay, &fixed);
                    }
                }
            });
            Ok(())
        })();
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "GTK child attachment interrupted.".to_string())?
}

pub async fn position(
    view: &Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    view.with_webview(move |native| {
        let result = (|| -> Result<(), String> {
            let content = native.inner();
            let fixed = content
                .parent()
                .ok_or("Child WebKit parent unavailable.")?
                .downcast::<gtk::Fixed>()
                .map_err(|_| "Embedded GTK surface unavailable.")?;
            let overlay = fixed
                .parent()
                .ok_or("Embedded GTK overlay unavailable.")?
                .downcast::<gtk::Overlay>()
                .map_err(|_| "Embedded GTK overlay unavailable.")?;
            overlay.set_overlay_pass_through(&fixed, false);
            // The native input surface must cover only the page, never the modal
            // header, dark overlay, dock or application titlebar.
            fixed.set_halign(gtk::Align::Start);
            fixed.set_valign(gtk::Align::Start);
            fixed.set_margin_start(x.round() as i32);
            fixed.set_margin_top(y.round() as i32);
            fixed.set_size_request(width.round() as i32, height.round() as i32);
            content.set_size_request(width.round() as i32, height.round() as i32);
            fixed.move_(&content, 0, 0);
            fixed.set_sensitive(true);
            // Allocate and paint the newly positioned widget without waiting
            // for an OS-level resize of the application window.
            content.show();
            fixed.queue_resize();
            content.queue_draw();
            constrain_input(&overlay, &fixed);
            Ok(())
        })();
        let _ = send.send(result);
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "GTK page positioning interrupted.".to_string())?
}

pub async fn inactive(app: &AppHandle) -> Result<(), String> {
    let Some(main) = app.get_webview("main") else {
        return Ok(());
    };
    let window = main.window();
    let (send, receive) = tokio::sync::oneshot::channel();
    main.with_webview(move |_| {
        if let Ok(root) = window.default_vbox() {
            if let Some((overlay, fixed)) = layers(&root) {
                overlay.set_overlay_pass_through(&fixed, true);
                fixed.set_sensitive(false);
                constrain_input(&overlay, &fixed);
            }
        }
        let _ = send.send(());
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "GTK page hiding interrupted.".to_string())
}
