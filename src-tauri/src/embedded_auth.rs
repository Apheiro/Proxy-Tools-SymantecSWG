//! Origin-scoped Windows management authentication. Never granted to generic external pages.
/// Clear the failed management site's data without clearing the shared WebView2
/// profile, which also contains the application's own settings and other sites.
#[cfg(target_os = "windows")]
pub(crate) async fn reset_session(view: &tauri::Webview, origin: String) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = std::sync::Arc::new(std::sync::Mutex::new(Some(send)));
    view.with_webview(move |native| {
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows::core::PCWSTR;
        let callback_send = send.clone();
        let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, _| {
            if let Ok(mut sender) = callback_send.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(status.map_err(|error| error.to_string()));
                }
            }
            Ok(())
        }));
        let method: Vec<u16> = "Storage.clearDataForOrigin".encode_utf16().chain(Some(0)).collect();
        let parameters: Vec<u16> = serde_json::json!({
            "origin": origin,
            "storageTypes": "all",
        }).to_string().encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            native.controller().CoreWebView2().and_then(|core| {
                core.CallDevToolsProtocolMethod(
                    PCWSTR::from_raw(method.as_ptr()),
                    PCWSTR::from_raw(parameters.as_ptr()),
                    &callback,
                )
            })
        };
        if let Err(error) = result {
            if let Ok(mut sender) = send.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(Err(error.to_string()));
                }
            }
        }
    }).map_err(|error| error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), receive)
        .await.map_err(|_| "Timed out clearing the proxy site session.".to_owned())?
        .map_err(|_| "Session cleanup was interrupted.".to_owned())?
}

#[cfg(target_os = "windows")]
pub(crate) fn install(
    view: &tauri::Webview,
    url: tauri::Url,
    username: String,
    password: String,
    accept_invalid_certificates: bool,
) -> tauri::Result<()> {
    use tauri::{Emitter, Manager};
    let app = view.app_handle().clone();
    let page_id = view.label().to_owned();
    view.with_webview(move |webview| {
        unsafe {
            use webview2_com::{
                BasicAuthenticationRequestedEventHandler,
                Microsoft::Web::WebView2::Win32::{
                    ICoreWebView2_10, ICoreWebView2_14,
                    COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                },
                ServerCertificateErrorDetectedEventHandler,
            };
            use windows::core::{Interface, PCWSTR};

            let controller = webview.controller();
            let core_webview = match controller.CoreWebView2() {
                Ok(core_webview) => core_webview,
                Err(error) => {
                    eprintln!("Failed to get WebView2 instance: {error}");
                    return;
                }
            };
            let webview_with_auth = match core_webview.cast::<ICoreWebView2_10>() {
                Ok(webview) => webview,
                Err(error) => {
                    eprintln!("WebView2 BasicAuthenticationRequested is unavailable: {error}");
                    return;
                }
            };

            let webview_with_certificates = match core_webview.cast::<ICoreWebView2_14>() {
                Ok(webview) => webview,
                Err(error) => {
                    eprintln!("WebView2 ServerCertificateErrorDetected is unavailable: {error}");
                    return;
                }
            };
            let certificate_origin = url.origin();
            let certificate_handler = ServerCertificateErrorDetectedEventHandler::create(Box::new(
                move |_sender, args| {
                    if let Some(args) = args {
                        let mut uri = windows::core::PWSTR::null();
                        args.RequestUri(&mut uri)?;
                        let uri = webview2_com::take_pwstr(uri);
                        // Internal appliances commonly use untrusted certificates. Limit the
                        // exception to this management origin; keep normal checks elsewhere.
                        if accept_invalid_certificates
                            && tauri::Url::parse(&uri)
                                .ok()
                                .is_some_and(|requested| requested.origin() == certificate_origin)
                        {
                            args.SetAction(
                                COREWEBVIEW2_SERVER_CERTIFICATE_ERROR_ACTION_ALWAYS_ALLOW,
                            )?;
                        }
                    }
                    Ok(())
                },
            ));
            let mut certificate_event_token = 0;
            if let Err(error) = webview_with_certificates.add_ServerCertificateErrorDetected(
                &certificate_handler,
                &mut certificate_event_token,
            ) {
                eprintln!("Failed to register WebView2 certificate handler: {error}");
                return;
            }

            let allowed_origin = url.origin();
            // WebView2 can repeat a challenge after the supplied credentials
            // were rejected. Never keep submitting them indefinitely.
            let challenges = std::sync::Mutex::new(std::collections::HashMap::<
                String,
                u8,
            >::new());
            let auth_handler =
                BasicAuthenticationRequestedEventHandler::create(Box::new(move |_sender, args| {
                    if let Some(args) = args {
                        let mut uri = windows::core::PWSTR::null();
                        args.Uri(&mut uri)?;
                        let uri = webview2_com::take_pwstr(uri);
                        if tauri::Url::parse(&uri)
                            .ok()
                            .is_none_or(|requested| requested.origin() != allowed_origin)
                        {
                            args.SetCancel(true)?;
                            return Ok(());
                        }
                        {
                            let mut attempts = match challenges.lock() {
                                Ok(attempts) => attempts,
                                Err(_) => {
                                    args.SetCancel(true)?;
                                    return Ok(());
                                }
                            };
                            let count = attempts.entry(uri).or_insert(0);
                            if *count >= 3 {
                                args.SetCancel(true)?;
                                if *count == 3 {
                                    let _ = app.emit_to(
                                        "main",
                                        "embedded:authentication-error",
                                        serde_json::json!({
                                            "id": page_id,
                                            "message": "The proxy rejected authentication after 3 attempts with the saved management credentials. Check the username, password and account permissions in Settings before reopening this page.",
                                        }),
                                    );
                                }
                                *count = count.saturating_add(1);
                                return Ok(());
                            }
                            *count += 1;
                        }
                        let response = args.Response()?;
                        let username_wide: Vec<u16> =
                            username.encode_utf16().chain(std::iter::once(0)).collect();
                        let password_wide: Vec<u16> =
                            password.encode_utf16().chain(std::iter::once(0)).collect();
                        response.SetUserName(PCWSTR::from_raw(username_wide.as_ptr()))?;
                        response.SetPassword(PCWSTR::from_raw(password_wide.as_ptr()))?;
                    }
                    Ok(())
                }));

            let mut event_token = 0;
            if let Err(error) =
                webview_with_auth.add_BasicAuthenticationRequested(&auth_handler, &mut event_token)
            {
                eprintln!("Failed to register WebView2 authentication handler: {error}");
                let _ = webview_with_certificates
                    .remove_ServerCertificateErrorDetected(certificate_event_token);
                return;
            }
        }
    })?;

    Ok(())
}
