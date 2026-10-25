//! App-scoped bindings shared by main-document keys and native child accelerators.
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Webview};
#[derive(Clone, Serialize, Deserialize)]
pub struct KeyBinding {
    key: String,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
}
type Bindings = HashMap<String, Option<KeyBinding>>;
pub struct ShortcutState(Mutex<Bindings>);
impl Default for ShortcutState {
    fn default() -> Self {
        let mut bindings = HashMap::new();
        for (action, key) in [
            ("previous", "ArrowLeft"),
            ("next", "ArrowRight"),
            ("up", "ArrowUp"),
            ("down", "ArrowDown"),
            ("minimize", "Escape"),
        ] {
            bindings.insert(
                action.into(),
                Some(KeyBinding {
                    key: key.into(),
                    ctrl: action != "minimize",
                    alt: false,
                    shift: false,
                    meta: false,
                }),
            );
        }
        bindings.insert("close".into(), None);
        Self(Mutex::new(bindings))
    }
}
fn supported(key: &str) -> bool {
    (key.len() == 1
        && key
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
        || key
            .strip_prefix('F')
            .and_then(|s| s.parse::<u32>().ok())
            .is_some_and(|n| (1..=24).contains(&n))
        || [
            "Escape",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Insert",
            "Delete",
            "Backspace",
            "Enter",
            "Tab",
            "Space",
        ]
        .contains(&key)
}
#[tauri::command]
pub async fn embedded_set_shortcuts(
    webview: Webview,
    app: AppHandle,
    bindings: Bindings,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("Only the application can configure shortcuts.".into());
    }
    let actions = ["previous", "next", "up", "down", "minimize", "close"];
    if bindings.len() != actions.len()
        || actions.iter().any(|action| !bindings.contains_key(*action))
    {
        return Err("Invalid shortcut actions.".into());
    }
    let mut used = HashSet::new();
    for binding in bindings.values().flatten() {
        if !supported(&binding.key) {
            return Err("Unsupported shortcut key.".into());
        }
        if !used.insert((
            binding.key.clone(),
            binding.ctrl,
            binding.alt,
            binding.shift,
            binding.meta,
        )) {
            return Err("Two actions cannot share the same shortcut.".into());
        }
    }
    let json = serde_json::to_string(&bindings).map_err(|e| e.to_string())?;
    *app.state::<ShortcutState>()
        .0
        .lock()
        .map_err(|_| "Shortcut state unavailable.")? = bindings;
    // Refresh retained Linux/macOS documents and their frames, without navigation.
    #[cfg(not(target_os = "windows"))]
    for (label, view) in app.webviews() {
        if label.starts_with("embedded-") {
            let _=view.eval(format!("window.dispatchEvent(new MessageEvent('message',{{data:{{channel:'embedded-shortcut-bindings',bindings:{json}}}}}));"));
        }
    }
    #[cfg(target_os = "windows")]
    let _ = json;
    Ok(())
}
pub fn script(app: &AppHandle) -> String {
    let json = app
        .state::<ShortcutState>()
        .0
        .lock()
        .ok()
        .and_then(|bindings| serde_json::to_string(&*bindings).ok())
        .unwrap_or_else(|| "{}".into());
    SCRIPT.replace("__BINDINGS__", &json)
}
#[cfg(target_os = "windows")]
pub fn action(
    app: &AppHandle,
    virtual_key: u32,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
) -> Option<String> {
    let key = match virtual_key {
        8 => "Backspace".into(),
        9 => "Tab".into(),
        13 => "Enter".into(),
        27 => "Escape".into(),
        32 => "Space".into(),
        33 => "PageUp".into(),
        34 => "PageDown".into(),
        35 => "End".into(),
        36 => "Home".into(),
        37 => "ArrowLeft".into(),
        38 => "ArrowUp".into(),
        39 => "ArrowRight".into(),
        40 => "ArrowDown".into(),
        45 => "Insert".into(),
        46 => "Delete".into(),
        48..=57 => char::from_u32(virtual_key)?.to_string(),
        65..=90 => char::from_u32(virtual_key)?
            .to_ascii_lowercase()
            .to_string(),
        112..=135 => format!("F{}", virtual_key - 111),
        _ => return None,
    };
    app.state::<ShortcutState>()
        .0
        .lock()
        .ok()?
        .iter()
        .find_map(|(action, value)| {
            value
                .as_ref()
                .filter(|b| {
                    b.key == key
                        && b.ctrl == ctrl
                        && b.alt == alt
                        && b.shift == shift
                        && b.meta == meta
                })
                .map(|_| action.clone())
        })
}
const SCRIPT: &str = r#"
(() => {
  if (navigator.platform.startsWith('Win')) return;
  let bindings=__BINDINGS__;
  const update=(next)=>{
    bindings=next;
    for(let i=0;i<frames.length;i++) { try { frames[i].postMessage({channel:'embedded-shortcut-bindings',bindings:next},'*'); } catch {} }
  };
  addEventListener('message',event=>{ if(event.data?.channel==='embedded-shortcut-bindings' && event.data.bindings && typeof event.data.bindings==='object') update(event.data.bindings); });
  addEventListener('load',event=>{ if(event.target===document || event.target===window || event.target instanceof HTMLIFrameElement) update(bindings); },true);
  addEventListener('keydown',event=>{
    if(event.defaultPrevented) return;
    const key=event.key===' '?'Space':event.key.length===1?event.key.toLowerCase():event.key;
    const action=Object.entries(bindings).find(([_,b])=>b && b.key===key && b.ctrl===event.ctrlKey && b.alt===event.altKey && b.shift===event.shiftKey && b.meta===event.metaKey)?.[0];
    if(!action) return;
    event.preventDefault();event.stopImmediatePropagation();location.href='embedded-control://shortcut/'+action;
  },true);
})();
"#;
