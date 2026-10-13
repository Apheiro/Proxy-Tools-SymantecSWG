# Repository instructions

## Commits and automated releases

Use Conventional Commits for all new commits and for PR titles that will be squash-merged:

`type(optional-scope): imperative description`

- `feat(backup): add scheduled backups` for new user-facing capabilities. This increments the minor version.
- `fix(ssh): handle fragmented password prompts` for bug fixes. This increments the patch version.
- `perf(preview): reduce memory usage` for performance improvements. This increments the patch version.
- `refactor`, `docs`, `test`, `build`, `ci`, `chore`, and `style` for changes of those kinds. They do not independently trigger a release. Do not mislabel internal cleanup as a feature or fix just to force a release.
- Mark incompatible changes with `!`, for example `feat(ssh)!: change automation response format`, and include a `BREAKING CHANGE: ...` footer explaining the migration. Before 1.0 this increments the minor version; from 1.0 onward it increments the major version.

Keep commits focused on one coherent change. Use scopes such as `ssh`, `backup`, `traffic`, `ui`, `credentials`, or `release` when useful. Never commit credentials, generated backups, build outputs, or test artifacts.

If squash-merging multiple changes, ensure the resulting commit preserves the highest-impact type and every breaking-change footer. Include additional Conventional Commit entries in the squash commit body when several independent user-facing changes need changelog entries. Preserve Release Please's generated release PR title, body and labels (`autorelease: pending` / `autorelease: tagged`).

Release Please manages one app version, tags `vX.Y.Z` and `CHANGELOG.md` on `main`. It synchronizes `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, the `proxytools` entry in `src-tauri/Cargo.lock`, and `.release-please-manifest.json`. Do not manually bump these files for routine changes. Do not regenerate or overwrite unrelated lockfile entries to change the application version.

`.github/workflows/release-please.yml` opens/updates the release PR. Merging that PR publishes the tag/release and explicitly calls the reusable Windows build. Do not rely on `release` or tag events created by `GITHUB_TOKEN` to trigger a separate workflow. The build checks out the exact release tag and uploads the EXE as a release asset. Manual build execution without a tag remains artifact-only; a tag can be supplied to retry an existing release's build/upload.

Validate release/workflow edits using actionlint and the actual Release Please strategy/updaters, including patch, feature, breaking-change and version synchronization checks. See [release instructions](docs/releases.md) for activation requirements and recovery steps. Commit or push only when requested by the user.

## Application updates and storage

Keep the application identifier `com.apheiros.proxytools` and Tauri's default storage paths. Do not add an identifier migration or replace the default base directories without an explicit user request.

Updates download the Windows release executable into the existing app cache, verify its size/SHA-256, and guide the user through manual replacement. Do not automatically close the app, replace its executable or launch PowerShell. GitHub authentication is optional: Live tokens use the shared Windows credential-vault module, Mocked Data tokens use their separate localStorage entry, and missing tokens use anonymous GitHub requests. Never copy credentials between profiles, expose saved Live tokens to the frontend, or reuse appliance credentials for GitHub. See [app update instructions](docs/app-updates.md).
