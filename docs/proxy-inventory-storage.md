# Proxy inventory storage and identity

The inventory is a JSON array in the main webview's **localStorage key `proxies`**, read/written by `utilsClient`. It is not stored in Windows Credential Manager or in backup/settings files owned by Rust. The main proxy workspace owns inventory writes: initial normalization, registration, connectivity refresh, deletion and tag editing. PAC, diagnostics, backups and policy workflows read this inventory.

The inventory currently uses the same key in Live and Mocked Data. Credential profile separation does not imply separate proxy inventories. Development and packaged builds can have separate web origins and webview profiles.

On Windows, the configured identifier is `com.apheiros.proxytools`. With no custom data directory, the installed Tauri 2.8.5 webview manager chooses the platform's LocalData directory joined with that identifier: `%LOCALAPPDATA%\com.apheiros.proxytools`. WebView2 manages the internal browser-profile files containing localStorage. Do not treat them as a standalone `proxies.json` file or edit their database while the application runs. This fix does not change that directory, identifier or storage schema.

## Identity fields

| Field | Purpose |
| --- | --- |
| `registered_address` | Original hostname or literal IP entered by the user; stable inventory identity used by tags and operations. |
| `primary_address` | Address used for connectivity checks, normally an IP after successful unambiguous resolution. |
| `hostname` | Display name; can be a real hostname or an IP fallback when no name has ever been learned. |
| `hostinfo.hostname` | Known full hostname, or `unknown` when none is known. |
| `hostinfo.ip` | Most recently known resolved address information. |
| `pinglog`, `nslookup` | Most recent connectivity/resolution diagnostics; not a permanent audit history. |

## Root cause and fix

After first resolving a named registration, a later refresh checks `primary_address`, often an IP. A failed PTR lookup returns an IP fallback for the response's display hostname, while `hostinfo.hostname` is `unknown`. The old merge rejected only blank/unknown strings, so it accepted the IP fallback as an updated hostname and persisted it over the saved display name. Initialization then preferred that IP over any full hostname or original named registration still available.

`proxyIdentity` now distinguishes IP literals from hostnames. A response with no actual hostname preserves the saved name. Valid newly discovered names still update observations. Initialization recovers a lost display name from a surviving full hostname, named registration or unambiguous proxy-name diagnostic, without interpreting the DNS server's name as the appliance's name. Refresh results merge against the current inventory state and retain tags and registered identity.

If every surviving field and diagnostic contains only IPs, the original hostname cannot be reconstructed locally. A subsequent successful PTR lookup or explicit user-provided hostname is needed; the app does not invent a name. The latest diagnostics can still report PTR failure even when a previously known hostname is retained.

## Verification

Model tests cover successful ICMP with failed PTR, repeated offline checks, IPv4/IPv6, recovery from surviving identity fields, valid new PTR names, address preservation and mutation-free normalization. Browser tests check the visible name and stored JSON across refreshes/reloads, existing tag edits and grouping behavior. No native build or live appliance access is required for this fix.
