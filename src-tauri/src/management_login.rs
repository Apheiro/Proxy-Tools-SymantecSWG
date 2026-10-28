//! Known SGOS management form only. Never discover arbitrary credential endpoints.
use regex::Regex;
use std::sync::LazyLock;

pub const LOGIN_PATH: &str = "/Secure/Local/console/login.htm";
pub const SUBMIT_PATH: &str = "/Secure/Local/console/mc_index.html";

pub fn is_login(html: &str) -> bool {
    static FORM: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?is)<form\b([^>]*)>(.*?)</form\s*>").unwrap());
    static POST: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)\bmethod\s*=\s*["']?post\b"#).unwrap());
    static ACTION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\baction\s*=\s*["']/Secure/Local/console/mc_index\.html["']"#).unwrap()
    });
    static USER: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?is)<input\b[^>]*\bname\s*=\s*["']username["']"#).unwrap());
    static PASS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?is)<input\b[^>]*\bname\s*=\s*["']password["']"#).unwrap());
    FORM.captures_iter(html).any(|form| {
        POST.is_match(&form[1])
            && ACTION.is_match(&form[1])
            && USER.is_match(&form[2])
            && PASS.is_match(&form[2])
    })
}

// Both scripts validate the actual document and action immediately before use.
// A navigation, popup or iframe from another origin never receives credentials.
const FIND_FORM: &str = r#"
if (window !== window.top || location.origin !== ORIGIN) return;
const form = [...document.forms].find(form => {
  const action = new URL(form.action, location.href);
  return form.method.toLowerCase() === 'post' && action.origin === ORIGIN &&
    action.pathname === '/Secure/Local/console/mc_index.html' &&
    form.querySelector('input[name="username"]') &&
    form.querySelector('input[name="password"][type="password"]');
});
if (!form) return;
"#;

pub fn detection_script(origin: &str) -> String {
    let find = FIND_FORM.replace("ORIGIN", &serde_json::to_string(origin).unwrap());
    format!(
        r#"(() => {{ {find}
      if (form.dataset.proxyToolsLoginRequested) return;
      form.dataset.proxyToolsLoginRequested = '1';
      location.href = 'embedded-control://form-login';
    }})()"#
    )
}

pub fn submission_script(origin: &str, username: &str, password: &str) -> String {
    let find = FIND_FORM.replace("ORIGIN", &serde_json::to_string(origin).unwrap());
    let user = serde_json::to_string(username).unwrap();
    let pass = serde_json::to_string(password).unwrap();
    format!(
        r#"(() => {{ {find}
      if (form.dataset.proxyToolsLoginSubmitted) return;
      form.dataset.proxyToolsLoginSubmitted = '1';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const fill = (input, value) => {{ setter.call(input, value); input.dispatchEvent(new Event('input', {{bubbles:true}})); input.dispatchEvent(new Event('change', {{bubbles:true}})); }};
      fill(form.querySelector('input[name="username"]'), {user});
      fill(form.querySelector('input[name="password"]'), {pass});
      const referer = form.querySelector('input[name="referer"]');
      const target = new URL(location.href).searchParams.get('referer');
      if (referer && !referer.value && target !== null) referer.value = target;
      const button = form.querySelector('[type="submit"]');
      if (button) button.disabled = false;
      if (button) form.requestSubmit(button); else form.requestSubmit();
    }})()"#
    )
}
