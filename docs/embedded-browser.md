# Embedded page manager

VPM and Admin Console now open as retained **native Tauri child webviews**, displayed in a shared Radix modal. These are not HTML iframes and do not create separate OS windows. Opening a URL already present restores and focuses its existing instance without reloading. The native manager matches both the original URL and current navigation URL, and serializes concurrent requests to avoid duplicates. The provider lives in the root layout so Next.js route changes preserve instances.

## Interaction

- Minimize, Escape or a click on the overlay hides the current page, releases the background application and exposes a compact floating dot dock. Each opener group has one dot, with a secondary child count. Its hover popover lists the individually selectable windows; clicking the main dot restores the group’s last active window.
- Close destroys only that webview. Closing a related popup returns to its parent when available. A page's native `window.close()` request on Windows is handled the same way.
- Ctrl+Left/Right and the header arrows traverse page groups circularly in opening order. Each group remembers its last active page.
- Ctrl+Up/Down traverses the root and same-origin popup layers within the current group, circularly in opening order. Previous window headers form a card stack behind the active one. Hovering the stack indicator reveals the selectable cascade; selection brings that window to the front and reorders the others. All derived popups stay with their opener, including cross-origin destinations. The current host and port are shown explicitly.
- The application surface is `inert` while a page is active. Radix manages the dialog without globally locking pointer events: the main application titlebar remains above and outside the dark overlay, accessible for minimize/maximize/close. Native WebView2 accelerators handle shortcuts even inside cross-origin frames. Native focus-boundary events return to the modal controls. A keyboard focus entry hands control back to the page.

The application does not reload, navigate or recreate a page when minimizing, restoring, switching or resizing. DOM state, scroll position and navigation stay in its native webview. Instances and their metadata are not persisted across application restarts. Browser cookies follow the existing engine profile; instances do not imply separate cookie containers.

## Presentation

The page viewport is measured with ResizeObserver. Native bounds use logical coordinates inside the modal's content slot; native views cannot be clipped or transformed by CSS. Opening/restoration and closing animate the modal chrome, with a minimal loading placeholder while initial navigation completes or the native view is being presented. Switching loaded pages uses a small lateral native-bounds transition without repeating the loader. Geometry updates are coalesced; presentation revisions reject stale show/hide requests. Reduced motion disables animated movement.

A slow initial load displays a message after 30 seconds; the page can still be minimized or closed. Loading metadata comes from native page-load events. Ordinary web-browser preview reports that native embedding requires the desktop application rather than silently substituting an HTML iframe or opening an external window.

## Architecture and security

- `src/lib/embeddedBrowser.ts`: public options, metadata and navigation helpers.
- `src/components/embedded-browser/provider.tsx`: session management, native events and shortcuts.
- `modal.tsx`, `content.tsx`, `dock.tsx`: modal chrome, measured native surface and restoration controls.
- `src-tauri/src/embedded_browser.rs`: authoritative page registry, child lifecycle, navigation policy, geometry and Windows keyboard/focus integration.
- `embedded_linux.rs`: preserves the main WebKit widget inside a GTK Overlay and reparents child widgets into a Fixed layer. This compensates for the runtime default GtkBox packing; native documents are retained. Logical positions are applied to the GTK widgets on the main thread. The native input layer is bounded to the page slot so it cannot intercept clicks on modal controls or the overlay.
- `embedded_auth.rs`: extracted origin-scoped WebView2 Basic authentication and optional certificate exception.

Child creation runs in async commands/tasks, not synchronous Windows event handlers. The main application is the only webview permitted to call the management commands. The capability is restricted to webview `main`; external child pages receive no remote IPC permission. Navigation is limited to HTTP(S) URLs without embedded credentials and excludes the application's own local/dev origin. Popups are intercepted rather than allowed to escape to unmanaged windows. Native credentials are omitted from every serialized snapshot.

Generic pages use normal certificate validation and no credentials. Optional authentication is scoped to the supplied HTTPS origin; accepting invalid certificates is an explicit option, disabled by default. The existing proxy VPM/Admin caller opts into its original certificate behavior. Only same-origin popups inherit that authentication policy. This does not grant credentials to external links or general internet pages.

In Mocked Data, VPM opens the MDN Window.open documentation and Admin opens `https://httpbin.org/forms/post`. The latter provides ordinary form state to test minimization/restoration. Mock credentials are never sent to those public sites. Other SSH/HTTP mocks are unaffected.

## Documented platform limitations

Tauri's `on_new_window` API can return a new OS `WebviewWindow`, not a child `Webview`. URL-bearing popup requests are therefore cancelled and routed into a new child. This preserves navigation and app grouping, but **does not preserve a JavaScript opener relationship, popup POST body, named-window reuse or a document written into an initial about:blank window**. Such workflows require specific native-engine integration; they are not claimed to be supported by this URL-based manager. Normal HTTP(S) target-blank links and URL-based window.open requests are the supported popup flow.

Native child embedding does not bypass browser TLS, mixed-content, authentication, OAuth or other site restrictions. On Linux, injected limited shortcut navigation handles document keys; behavior inside frames and native composition needs testing against WebKitGTK. Windows uses WebView2 controller events rather than exposing privileged IPC to remote scripts. Test the actual VPM/Admin popups on the appliance before relying on them operationally.

## Tauri upgrade and validation

Core Rust is pinned to 2.12.5, API/CLI resolve to 2.12.4, build tooling to 2.7.4 and Opener to 2.7.2. Windows bindings are aligned with the runtime (`webview2-com` 0.39.1 and `windows` 0.62.2). Child webviews require the existing Tauri 2 `unstable` feature, enabled explicitly. The identifier, application release version and default storage paths are unchanged. Rust stable >=1.90 satisfies the updated Opener requirement.

Validation commands do not compile the native app:

- `pnpm exec tsc --noEmit`
- `cargo metadata --locked --no-deps --manifest-path src-tauri/Cargo.toml --format-version 1`
- `pnpm exec playwright test --config tests/embedded-browser-model.config.ts`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test tests/e2e/embedded-browser.spec.ts`

Browser tests simulate native IPC, not the rendering engine. They cover retained instances, public mock targets without credentials, geometry, preservation across route changes/restoration, cyclic shortcuts, related and unrelated popups, closing, overlay minimization and reduced motion. Native URL/authentication serialization tests are provided in Rust. Windows rendering, WebView2 accelerators, real appliance authentication and engine-specific behavior still require native acceptance testing.

References reviewed before implementation:

- [Updating Tauri dependencies](https://v2.tauri.app/develop/updating-dependencies/)
- [WebviewBuilder and async creation](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewBuilder.html)
- [Child webviews](https://docs.rs/tauri/2.12.5/tauri/window/struct.Window.html#method.add_child)
- [Popup response limitations](https://docs.rs/tauri/2.12.5/tauri/webview/enum.NewWindowResponse.html)
- [Capabilities and remote access](https://v2.tauri.app/security/capabilities/)
