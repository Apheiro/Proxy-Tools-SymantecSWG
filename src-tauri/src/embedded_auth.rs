//! Origin-scoped Windows management authentication. Never granted to generic external pages.
#[cfg(target_os = "windows")]
pub(crate) fn install(
    view: &tauri::Webview,
    url: tauri::Url,
    username: String,
    password: String,
    accept_invalid_certificates: bool,
) -> tauri::Result<()> {
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
