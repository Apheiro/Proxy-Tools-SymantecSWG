//! Legacy Basic auth and detected SGOS form sessions share one origin-scoped transport.
//! Share pools/cookies only within one origin and credential identity; never persist them.
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client, Url,
};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
struct LoginState {
    form: Option<bool>,
    authenticated_at: Option<Instant>,
}
struct Session {
    client: Option<Client>,
    form_client: Client,
    login: Arc<tokio::sync::Mutex<LoginState>>,
    authorization: Option<HeaderValue>,
    touched: Instant,
    retry_after: Option<Instant>,
}
static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static AUTH_ENCODER: LazyLock<Client> = LazyLock::new(Client::new);
const IDLE_TTL: Duration = Duration::from_secs(15 * 60);

fn authentication_header(
    url: &Url,
    username: &str,
    password: &str,
    mock: bool,
) -> Result<Option<HeaderValue>, String> {
    if !mock && username.contains(':') {
        return Err("HTTP Basic usernames cannot contain a colon.".into());
    }
    let authorization = if !mock && !username.is_empty() && !password.is_empty() {
        let request = AUTH_ENCODER
            .get(url.clone())
            .basic_auth(username, Some(password))
            .build()
            .map_err(|_| "Could not prepare management authentication.")?;
        let mut value = request
            .headers()
            .get(AUTHORIZATION)
            .cloned()
            .ok_or("Missing management authentication.")?;
        value.set_sensitive(true);
        Some(value)
    } else {
        None
    };
    Ok(authorization)
}

pub fn client_for(url: &Url, username: &str, password: &str, mock: bool) -> Result<Client, String> {
    let origin = url.origin().ascii_serialization();
    let authorization = authentication_header(url, username, password, mock)?;
    let mut sessions = SESSIONS
        .lock()
        .map_err(|_| "Management sessions are unavailable.")?;
    sessions.retain(|_, session| session.touched.elapsed() < IDLE_TTL);
    if let Some(session) = sessions.get_mut(&origin) {
        if session.authorization == authorization {
            if session
                .retry_after
                .is_some_and(|until| until > Instant::now())
            {
                return Err("Management authentication failed. Update your credentials, or wait 30 seconds before retrying.".into());
            }
            session.touched = Instant::now();
            if let Some(client) = &session.client {
                return Ok(client.clone());
            }
        }
    }
    let cookies = Arc::new(CookieStoreMutex::new(CookieStore::default()));
    let build = |basic: bool| -> Result<Client, String> {
        let mut headers = reqwest::header::HeaderMap::new();
        if basic {
            if let Some(value) = &authorization {
                headers.insert(AUTHORIZATION, value.clone());
            }
        }
        Client::builder()
            .default_headers(headers)
            .cookie_provider(cookies.clone())
            .user_agent("trace-tools/0.1")
            .danger_accept_invalid_certs(true)
            .connect_timeout(Duration::from_secs(15))
            .pool_idle_timeout(Duration::from_secs(90))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 10 {
                    return attempt.error("Too many management redirects.");
                }
                if attempt
                    .previous()
                    .first()
                    .is_some_and(|first| first.origin() != attempt.url().origin())
                {
                    return attempt.error("Management redirects must stay on the selected origin.");
                }
                attempt.follow()
            }))
            .build()
            .map_err(|_| "Could not prepare the management connection.".into())
    };
    let client = build(true)?;
    let form_client = build(false)?;
    if sessions.len() >= 16 {
        if let Some(oldest) = sessions
            .iter()
            .min_by_key(|(_, s)| s.touched)
            .map(|(key, _)| key.clone())
        {
            sessions.remove(&oldest);
        }
    }
    sessions.insert(
        origin,
        Session {
            client: Some(client.clone()),
            form_client,
            login: Arc::new(tokio::sync::Mutex::new(LoginState::default())),
            authorization,
            touched: Instant::now(),
            retry_after: None,
        },
    );
    Ok(client)
}

async fn login_html(mut response: reqwest::Response) -> Result<String, String> {
    let mut content = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read the proxy login response.")?
    {
        if content.len() + chunk.len() > 512 * 1024 {
            return Err("Proxy login response exceeds 512 KiB.".into());
        }
        content.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&content).into_owned())
}

/// Probe only the fixed SGOS login URL, once per origin/credential session.
/// Old appliances keep preemptive Basic auth; form appliances get a cookie-aware
/// client without an Authorization header. Mock endpoints never receive a login.
pub async fn authenticated_client_for(
    url: &Url,
    username: &str,
    password: &str,
    mock: bool,
) -> Result<Client, String> {
    let legacy = client_for(url, username, password, mock)?;
    if mock {
        return Ok(legacy);
    }
    if url.scheme() != "https" {
        return Err("Management form credentials require HTTPS.".into());
    }
    let identity = authentication_header(url, username, password, false)?;
    let (client, state) = {
        let sessions = SESSIONS
            .lock()
            .map_err(|_| "Management sessions are unavailable.")?;
        let session = sessions
            .get(&url.origin().ascii_serialization())
            .ok_or("Management session was cleared.")?;
        if session.authorization != identity {
            return Err("Management credentials changed; retry the operation.".into());
        }
        (session.form_client.clone(), session.login.clone())
    };
    let mut state = state.lock().await;
    if state.form == Some(false) {
        return Ok(legacy);
    }
    if state
        .authenticated_at
        .is_some_and(|at| at.elapsed() < Duration::from_secs(10 * 60))
    {
        return Ok(client);
    }
    if state.form.is_none() {
        let login = url
            .join(crate::management_login::LOGIN_PATH)
            .map_err(|_| "Invalid management login URL.")?;
        let response = client
            .get(login)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|_| "Could not detect the proxy management login method.")?;
        if !response.status().is_success() {
            state.form = Some(false);
            return Ok(legacy);
        }
        let html = login_html(response).await?;
        if !crate::management_login::is_login(&html) {
            state.form = Some(false);
            return Ok(legacy);
        }
        state.form = Some(true);
    }
    if username.is_empty() || password.is_empty() {
        return Err("Save proxy management credentials in Settings first.".into());
    }
    let endpoint = url
        .join(crate::management_login::SUBMIT_PATH)
        .map_err(|_| "Invalid management login URL.")?;
    for _ in 0..3 {
        let response = client
            .post(endpoint.clone())
            .form(&[
                ("username", username),
                ("password", password),
                ("referer", ""),
            ])
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|_| "Could not submit the proxy management login form.")?;
        if matches!(response.status().as_u16(), 401 | 403) {
            break;
        }
        if !response.status().is_success() {
            return Err(format!(
                "Proxy management login returned HTTP {}.",
                response.status().as_u16()
            ));
        }
        let html = login_html(response).await?;
        if crate::management_login::is_login(&html) {
            continue;
        }
        // HTTP 200 alone is not authentication success. This is the signed-in
        // console shell observed in SGOS 7.4.18.2, not merely a login response.
        if html.contains("logoutForm") && html.contains("app_iframe") {
            state.authenticated_at = Some(Instant::now());
            return Ok(client);
        }
        return Err("The proxy returned an unrecognized management login response; authentication was not confirmed.".into());
    }
    invalidate(url, username, password, false);
    Err("Proxy management form authentication failed (maximum 3 attempts). Check the saved account and password.".into())
}

/// Never parse a successful HTTP 200 login page as policy, trace or log data.
pub fn check_document(
    html: &str,
    url: &Url,
    username: &str,
    password: &str,
    mock: bool,
) -> Result<(), String> {
    if !mock && crate::management_login::is_login(html) {
        invalidate(url, username, password, false);
        return Err("The proxy returned its login form instead of the requested data. Its management session expired or was rejected; retry to sign in again.".into());
    }
    Ok(())
}

pub fn invalidate(url: &Url, username: &str, password: &str, mock: bool) {
    let Ok(authorization) = authentication_header(url, username, password, mock) else {
        return;
    };
    if let Ok(mut sessions) = SESSIONS.lock() {
        if let Some(session) = sessions.get_mut(&url.origin().ascii_serialization()) {
            if session.authorization == authorization {
                session.client = None;
                session.retry_after = Some(Instant::now() + Duration::from_secs(30));
            }
        }
    }
}

#[tauri::command]
pub fn clear_management_sessions() {
    if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.clear();
    }
}
