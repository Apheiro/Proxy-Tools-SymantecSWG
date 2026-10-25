# Interface preferences

Settings is organized into General, Credentials, Local Policy, Updates and Shortcuts using the existing Radix Tabs primitives. Small screens use the shared Select. Category navigation stays fixed while its content scrolls. Panels remain mounted to preserve unsaved drafts when changing category.

General includes an opt-in **Proxy card context menu** preference. When enabled, right-click on a focusable proxy card (or Shift+F10/the keyboard menu key) opens the Radix context menu and hides the three-dot button. Both menus render the same action definition. Editing fields retain their standard context interaction. The option is off by default.

Shortcuts can be recorded, disabled, reset individually or reset together. Capture ignores modifier-only keys, checks conflicts and preserves ordinary typing by requiring a modifier except for function keys. Escape cancels capture; restoring the default Minimize binding restores Escape. Supported keys include letters, digits, function and navigation keys. OS-reserved combinations may not reach the app.

Preferences persist in the main application's localStorage key `app-interface-preferences`; no credentials are stored there. `shortcutBindings.ts` defines the frontend action registry/defaults and matching rules; `appPreferences.ts` broadcasts changes to the settings and proxy cards. Window bindings are sent to Rust by the root embedded-browser provider. Native Windows accelerators use that map, including inside nested frames. Other platforms refresh the limited document/frame shortcut bridge in retained webviews without reloading them. These are application-scoped shortcuts, not global OS shortcuts.

No tests or builds were run for this change, per the repository execution preference. Rust changes require the native backend to reload.
