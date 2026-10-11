# Native proxy networking

`getproxystatus` remains the single Tauri entry point for inventory registration
and status refresh. Previously it spawned `ping.exe -n 4` and `nslookup.exe`, then
parsed their English console output. All process execution and output parsing
have been removed from this path. The frontend and stored inventory retain the
same IPC fields, including the legacy names `pinglog` and `nslookup`.

## Resolution and identity

- `tokio::net::lookup_host((hostname, 0))` uses the operating system resolver,
  including hosts files and system search rules. It is not a direct A/AAAA query.
  Results are deduplicated and retain all IPv4/IPv6 addresses.
- Literal IPs skip forward resolution. Probing prefers IPv4 when a hostname
  resolves to both families, matching the former Windows ping selection.
- Hickory 0.25.2 reads system DNS configuration and queries PTR for the probed
  address. No public resolver is substituted when configuration fails. PTR
  failures do not prevent ICMP or registration. A literal without PTR retains
  its IP and reports `hostinfo.hostname = "unknown"`.
- Named registrations retain their input hostname; the system lookup API does
  not return a canonical DNS name. Display names use the first hostname label
  after successful resolution. DNS failure retains the full registered name.
- A supplied IP stays the primary address. A named registration switches to an
  IP only when it resolves to exactly one address and ICMP confirms reachability.
- `hostinfo.dnsip` contains configured PTR resolver IPs, not proof of which
  server answered. `dnsname` remains `unknown`: no resolver hostname is invented.

Forward resolution and the entire PTR lookup each have a five-second deadline.
Hickory additionally uses one attempt and a five-second per-request timeout.
The OS resolver's underlying blocking operation may finish after the awaiting
Tokio future times out; the application does not block waiting for that result.

## ICMP and Windows permissions

Surge-ping 0.8.4 sends four 32-byte ICMP echo probes, with four seconds per probe
and a minimum one-second start interval. A positive reply makes `active = true`;
zero replies makes it false. This intentionally corrects the old regex-based
behavior where a single timed-out packet could mark an otherwise responsive
host inactive. ICMP reachability does not guarantee management-port availability.

Windows raw sockets require administrator privileges. To preserve checks under
a normal Windows account, socket creation errors indicating access denial fall
back to `IcmpSendEcho` (IPv4) or `Icmp6SendEcho2` (IPv6). These APIs live in
`iphlpapi.dll`; no external process is launched. Synchronous calls execute in
`spawn_blocking`, use bounded per-probe timeouts, and close handles through RAII.
Only successful echo replies count; Windows destination-unreachable statuses do
not count as replies. Other surge-ping socket errors remain visible in the log.

Linux may require ping-socket permission or `CAP_NET_RAW`. Permission failures,
missing DNS responses and ICMP errors return an inventory result with diagnostic
logs, rather than preventing registration. An unavailable check has `active =
false`; inspect the ping log to distinguish a local error from absent replies.

References:

- [Windows raw socket permissions](https://learn.microsoft.com/en-us/windows/win32/winsock/tcp-ip-raw-sockets-2)
- [IcmpSendEcho](https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmpsendecho)
- [Icmp6SendEcho2](https://learn.microsoft.com/en-us/windows/win32/api/icmpapi/nf-icmpapi-icmp6sendecho2)
- [Hickory system resolver configuration](https://docs.rs/hickory-resolver/0.25.2/src/hickory_resolver/resolver.rs.html)

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline native_icmp_loopback -- --ignored
node --experimental-strip-types --test src/lib/trafficAnalysis.test.mjs
pnpm exec tsc --noEmit
```

Tests cover registration and IPC compatibility, DNS failures, input validation,
partial ICMP responses, permission errors, primary-address preservation, IPv6,
and actual PTR requests against a local UDP DNS server (positive answers,
NXDOMAIN and no response). DNS tests require local UDP socket access. The native
ICMP smoke test is opt-in because it depends on socket permission and ICMP being
enabled. The existing access-log benchmark remains opt-in.

On Windows, also run the IP Helper test as a normal user:

```sh
cargo test --manifest-path src-tauri/Cargo.toml windows_icmp_loopback_without_raw_sockets -- --ignored
```

Windows target compilation and execution still need validation on Windows. The
development environment is Linux, and installing the cross-compilation target
was not authorized. Check inventory registration and refresh with a hostname,
an IP with PTR, an IP without PTR, an unreachable target, and DNS disconnected.

Validated on the Linux development environment: 18 Rust tests passed with two
opt-in tests excluded; the native ICMP IPv4/IPv6 loopback smoke test also passed
when run explicitly. The available frontend test file, TypeScript check, and
format/whitespace checks passed. Five existing Rust warnings remain in unrelated
management-window, credentials and file-list code.
