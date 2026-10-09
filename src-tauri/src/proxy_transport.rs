//! Management Basic auth is sent preemptively, not exchanged for an OAuth token.
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

struct Session {
    client: Option<Client>,
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
                return Err("Authentication failed (HTTP 401). Update your credentials, or wait 30 seconds before retrying.".into());
            }
            session.touched = Instant::now();
            if let Some(client) = &session.client {
                return Ok(client.clone());
            }
        }
    }
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(value) = &authorization {
        headers.insert(AUTHORIZATION, value.clone());
    }
    let client = Client::builder()
        .default_headers(headers)
        .cookie_provider(Arc::new(CookieStoreMutex::new(CookieStore::default())))
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
        .map_err(|_| "Could not prepare the management connection.")?;
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
            authorization,
            touched: Instant::now(),
            retry_after: None,
        },
    );
    Ok(client)
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
