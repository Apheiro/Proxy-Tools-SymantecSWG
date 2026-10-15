# Application updates

The app checks `Apheiro/Proxy-Tools-SymantecSWG` for the latest stable GitHub release at native startup. A newer semantic version is announced with a clickable Sonner notification at the bottom right. Other notifications keep their existing position. Clicking the notification opens the shared Radix dialog with the complete release body formatted using `markdown-to-jsx`. The renderer loads on demand when the dialog opens, reuses the application's theme tokens and renders headings, lists, emphasis, code, tables and links. Embedded HTML is treated as text, remote images are not loaded and only HTTPS links can open through the existing Tauri Opener plugin.

The release-notes dialog uses a wider desktop layout and a viewport-bounded height. The shared Radix ScrollArea scrolls the notes while the title and action buttons remain visible. Version comparison is unchanged: a development build still uses its local configured version, so it can legitimately report a newer published release even when the local source contains the same features. Release Please remains responsible for version bumps.

The release must contain an uploaded `proxytools-vX.Y.Z-windows-x64.exe` asset with a valid GitHub SHA-256 digest. Release Please publishes the release before the Windows build finishes, so a release without its executable is not announced. Preview versions and drafts are ignored. **Settings → Application updates → Check for updates** allows retrying after the build finishes and displays network, permission and rate-limit errors. Automatic startup failures do not interrupt proxy work or display repeated error notifications.

## Optional GitHub authentication

Enter a fine-grained token restricted to the repository with **Contents: Read** in Settings. This permission includes reading the source code as well as releases. The token is independent of appliance credentials:

- Live: Windows Credential Manager target `proxytools/github-release-token`. The UI only receives whether a token is present, not the saved secret. Leave the replacement input empty unless changing the token.
- Mocked Data: separate localStorage entry `mock-github-release-token`, supporting native development on Linux. Mock token reads/saves/removals do not access the Windows vault. The profile switch does not copy tokens between profiles.
- Without a token: normal unauthenticated GitHub requests. When the repository becomes public, remove the saved token and revoke it in GitHub. Making the repository public does not itself revoke a token.

Mocked Data changes the credential storage; release queries still contact the real GitHub repository. Browser tests replace native IPC, so they do not contact GitHub or use real credentials. Do not put a token in source code, releases, workflow arguments or logs.

HTTP requests originate in Rust, use normal TLS certificate validation and bypass appliance/environment proxies. Asset API calls carry the token only to GitHub's fixed API endpoint. Redirected downloads use a separate request without the Authorization header, restricted to known HTTPS GitHub asset hosts. There is no local SSH or PowerShell process involved.

## Manual executable replacement

Confirm **Download update** in the release dialog. Rust streams the response into an exclusive `.part` file under the existing Tauri `app_cache_dir()/updates` directory. It checks the expected size, Windows executable prefix and SHA-256 digest before publishing the final file. Interrupted or invalid downloads remove their partial files. Complete existing downloads are verified before reuse; mismatching files are not overwritten. Downloads have bounded timeouts and only one can run at a time.

After verification the dialog shows the downloaded file, the current executable location and replacement instructions. **Open download folder** uses the existing Tauri Opener plugin with a path resolved in Rust, never a frontend-supplied arbitrary path. Finish active work, close the app, keep a copy of the previous executable, move/rename the new executable into the previous location and run it. The app never deletes or replaces its running executable. Windows may require elevation when replacing an executable in a protected location. Move the downloaded executable before clearing the app's cache.

SHA-256 checks integrity against GitHub's release metadata; this does not add an independent publisher signature or Windows code signing. The release workflow and trusted GitHub repository remain the source of the executable. Existing manual-build artifacts without a GitHub release asset are not offered as updates.

The application identifier remains `com.apheiros.proxytools`. Storage uses Tauri's existing default paths. There is no identifier migration, custom base directory, version bump or change to the proxy credential target.

## Validation

- Native tests cover semantic comparisons, stable/completed asset selection, optional authentication, rejected token/header input, destination validation, multi-megabyte download integrity and partial-file cleanup after corruption or interruption.
- Browser tests cover the persistent clickable notification, Markdown formatting and safe links/HTML handling, scrolling long notes with fixed title/actions, download/retry instructions, opening the folder, mock persistence, separate live credential IPC and anonymous checks after token removal. Existing credentials and Backup Manager tests remain applicable.
- Real Windows vault access and Explorer integration require a Windows run. An authenticated end-to-end release download requires a configured token and an existing uploaded release. No live token is needed for the automated fixture tests.
