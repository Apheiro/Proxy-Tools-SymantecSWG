# Local Policy Manager

Open **Local Policy Manager** in the shared workspace navigation (`/policy`). The visual editor is selected by default. Proxy inspection sits above the full-width editor. Visual operations patch only the selected source ranges; unrelated rules and comments stay in place. The application does not reconstruct a Symantec VPM XML project.

## Visual editor and optional source mode

The guided rule editor uses **Source, Destination, Service, Time, Action and Combined / other** columns. Click a cell to open that part of the rule. For a basic rule, add a Client IP/subnet, a destination Domain and an Allow/Deny action, then save the draft. No CPL gesture names are needed for these fields.

- A shared capability registry powers both guided forms and the optional advanced expression composer: identities/realms/groups, IPv4/IPv6 operands, URL matching, categories, HTTP methods/ports, authentication, TLS/keyrings, ICAP, exceptions, caching and tracing. Imported/custom expressions remain supported through advanced controls. This registry is **not an exhaustive version-specific SGOS catalogue or compiler**.
- The layer navigator retains evaluation order. Layer settings edit header conditions and default properties together, without dropping existing properties such as `<Proxy> authenticate(no)`. Adjacent layer/rule reorder operations retain their existing safety restrictions around preserved source and definitions.
- Named conditions are indexed on demand from the CPL. Objects limited to one semantic column can appear there; objects mixing origin and destination stay compound. The condition inspector shows OR alternatives and AND expressions within each row, follows nested references and virtualizes large lists. Cycles and locally unresolved references are visible; references may belong to other appliance policy sources.
- **Objects → Edit list** supports bulk editing, renaming active references and duplicating objects. A shared-object modification requires acknowledgement of its direct uses. Existing comments and named terminators are retained. Renaming refuses potentially affected opaque or disabled source. Duplicate names are reported rather than treated as proof of a valid policy.
- **Add object → Paste a list of values** creates typed alternative lists without adding one expression at a time. Existing multi-condition rows cannot be silently converted to independent values. Use their row editor or advanced full-alternative list mode.
- Rules, object bodies and condition inspection are virtualized. Search, duplicate, reorder, enable/disable, undo and redo remain available. Disabled editor rules use a reversible `; @proxytools-disabled: ` comment marker; arbitrary imported comments are never activated automatically.
- **Edit CPL source** is off by default. Both modes share one CPL draft. Manual changes retain their warning, unsupported constructs remain visible, and switching modes does not regenerate the whole file.

All policy objects and references are reconstructed from the CPL itself. No XML project or policy sidecar is required. The source text remains authoritative, including comments, expression order, capitalization and unrelated manual edits. Source recognition is not proof that the SGOS compiler accepts a construct.

### Verified coverage and remaining limits

The current registry has 61 guided capabilities. Against the supplied Local Policy sample, all 38 distinct condition/property names are recognized, all 170 rules are syntactically editable, and no-op edits of every rule and all 16 definitions retain the exact source bytes. This is evidence for that sample, not proof of complete parity with every object, wizard, timing constraint or version-specific feature of Broadcom VPM. Unsupported expressions remain available in advanced CPL and are never silently rewritten.

The project XML in the downloaded VPM snapshot is a separate policy source, not the Local Policy sample. Its captured data, session artifacts and vendor bundle are not application dependencies and have not been added as public test fixtures.

## Independent methods

Configure both switches in **Settings → Local Policy Manager** for the current Live/Mock profile:

- **Direct proxy editing & distribution** is enabled initially. It uses the existing inventory and saved appliance SSH credentials, including the same password for interactive `enable`.
- **Central SSH file editing** is initially disabled. Configure either SSH read/write access or an HTTPS read-only direct file link. SSH requires server, port, absolute policy path, account, password and remote shell. When enabled it is the preferred method on entering the workspace; direct editing remains independently available. This mode changes only the file. Its existing HTTP/FTP distribution mechanism remains external.

Central SSH passwords use their own Windows Credential Manager target. Live secrets are not returned to the settings UI. Mock passwords use only `mock-central-policy-password` in localStorage and never migrate into the Live vault. Nonsecret settings use separate profile files in Tauri's existing app cache. The identifier and default base directories are unchanged.

### Optional shared policy document

Plain CPL remains the default file format. The optional shared format is **Proxy Tools JSON version 1**, not Broadcom VPM XML:

```json
{
  "format": "proxytools-policy",
  "version": 1,
  "cpl": "<Proxy>\nurl.domain=example.com allow\n"
}
```

The complete CPL is stored in `cpl`; no independently maintained visual model can drift away from it. **Export shared JSON** creates this file. **Import CPL / JSON** opens either format without SSH or credentials. This schema version is separate from the application's release version. Unsupported schemas/versions are rejected.

Enable central editing, select **Shared JSON** and choose an access method:

- **SSH:** read/save an existing hosted JSON file using the existing byte comparison, advisory lock, replacement and readback scripts. The backend compares the original entire JSON, not only its CPL. It preserves additional JSON properties; saving a modified CPL may reformat the envelope. A no-op keeps the existing envelope bytes. Passwords remain in the separate central SSH credential store.
- **HTTPS:** download an existing file through a direct HTTPS link with no login page. This mode is read-only; export and upload through the hosting service to publish changes. HTML/login responses are not treated as policies. Private SharePoint/Microsoft Graph authentication is outside the currently requested scope. HTTPS requires no stored SSH password, rejects embedded URL credentials, enforces TLS, limits redirects/size/time, and makes no remote web request in Mocked Data. Local imports still work in Mocked Data.

Use **Use draft for direct distribution** to retain a loaded shared CPL while inspecting destinations. The original shared snapshot is retained and rechecked before the job starts and before each destination write. A changed document, changed settings or expired snapshot prevents that write. Proxy-majority and per-destination checks remain in force. There is no atomic transaction across the hosting service and an entire fleet; a source change during a run can leave already completed destinations applied and later ones in conflict.

### Central server requirements

SFTP is not required. Scripts run over a non-PTY SSH exec channel with the full script streamed through stdin, not a command-line argument:

- POSIX: `sh`, `cat`, `base64 -d`, `cmp`, `cp -p`, `mv`, `mkdir`, `rm`, `rmdir`. The account needs read/write access to the file and its parent directory. POSIX absolute paths and spaces/quotes are supported. File permissions are retained with `cp -p`. A private lock directory beside the source contains temporary files. Rename publishes the replacement on the same filesystem. Symbolic-link files are rejected.
- Windows: Windows PowerShell and .NET file APIs, an absolute Windows/UNC path, and permission to create a lock and replacement beside the file. `.NET File.Replace` must be supported by that filesystem (normally NTFS); it preserves destination metadata/ACL semantics. No delete-original fallback is used. Reparse-point files are rejected.

Read loads the original UTF-8 bytes. Save checks the exact original again under a remote exclusive advisory lock and immediately before replacement, then verifies the complete readback. Unchanged lines retain their original line endings and BOM; inserted lines use the original dominant line ending. Non-UTF-8 and unsupported control characters are rejected rather than converted lossily. If a conflict occurs, the draft is kept. Use **Compare remote & draft**, review the latest file, then explicitly choose **Use latest baseline · keep draft** before reviewing a new save. A stale lock after server interruption needs manual inspection/removal; the app never deletes another writer's lock automatically.

## Create a policy from scratch

Choose **New policy** in the editor toolbar to start with an empty visual draft. Add layers, ordered rules and reusable objects, or optionally switch to CPL source. No default allow/deny decision is inserted. Creation and **Export CPL** require neither a connection nor saved SSH credentials. Export downloads the current draft as `local-policy.cpl`; it is not a compiler validation.

Starting another policy asks before discarding unsaved edits. Drafts remain in memory only. **Discard draft** clears a new policy back to its empty starting point.

For direct distribution, **Inspect all** preserves the new draft and selects a healthy majority proxy as a **Validation baseline**, without importing any of its rules. Changing that baseline also preserves the draft. All existing majority exclusions, explicit override requirements, per-destination conflict checks and full replacement confirmation still apply. A new policy replaces the complete Local Policy on the selected destinations.

For central SSH editing, compose the new policy first; **Review & save** reads the existing configured remote file if no baseline has been captured yet. Its snapshot is used for the replacement diff and concurrent-change checks, while the new draft stays intact. This replaces an existing remote file; it does not provision missing files or directories. Empty replacements are disabled in both workflows.

## Direct workflow

1. **Inspect all** queries all configured proxies, including unreachable ones in the census. Up to four SSH reads run concurrently. The app uses `enable`, responds to its password challenge, enters `config terminal`, and reads `show sources policy local`.
2. Policies are grouped by SHA-256 with only BOM/CRLF and final transport newlines normalized. A strict majority requires more than half of **all** configured proxies; failures do not inflate its count. A tie or insufficient responses disables bulk distribution.
3. Choose a captured reference source. The majority is only a comparison baseline; the operator must review its validity. An explicit reference override allows using another healthy proxy's source. This never silently adds discrepant proxies to the bulk selection.
4. Edit the complete CPL through visual controls or the optional source mode. **Compare with majority** shows differences, with line numbers and a virtualized diff. Red rows are excluded from bulk actions. A readable excluded proxy can be replaced through **Review individual replacement**, a separately confirmed single-destination operation. If no majority exists, an explicit source override is required for such an individual operation.
5. Review the destination-to-draft diff and destinations, then acknowledge the full-file replacement. The backend repeats the entire census before starting; changed fingerprints/majority abort the run before any writes. Each destination is read once more immediately before its upload.
6. Upload the complete policy with `inline policy local <unique-delimiter>`, the multiline CPL and that delimiter on an independent line. The generated delimiter cannot equal a CPL source line. Upload and output consumption run concurrently to avoid SSH-window deadlocks. Success requires the compiler's final `ok` and matching full source readback.

Progress survives workspace navigation while this app process is running and shows pending, running, success, conflict or failure per proxy. Closing the main window is blocked during distribution. Completed targets are not rolled back if a later target fails. A failure after upload can leave an uncertain remote state; the app does not automatically retry. Inspect all proxies again before another distribution.

## Validation and concurrency limits

The native service performs **structural checks**, not a complete version-specific CPL compiler: UTF-8, size, control characters, obvious HTML/XML/configuration wrappers, layer/definition presence, and unmatched definition boundaries (including named terminators). Literal HTML inside string definitions is retained. Unknown conditions, actions and manually authored rules remain intact. Empty existing policy can be read, but accidental empty replacement is disabled. A policy that passes these checks still needs operator review and SGOS compilation. Central saves cannot ask an appliance to compile a file whose distribution is external.

Limits are explicit: 4 MiB per document, 32 MiB per inspection, 256 configured targets per inspection, 120 seconds per capture/upload/script and existing SSH operation/idle timeouts. Exceeding a limit rejects the operation; content is never silently truncated. Diffs have a bounded computation budget and retain the complete compared text even if a coarse diff is necessary. Up to two recent inspection snapshots and four central documents remain in native memory, scoped by data profile; CPL drafts are not persisted in browser storage.

Remote locks coordinate central-file writes made by this application. Other administrators or tools that ignore the lock can still race between the final check and atomic replacement. The appliance CLI provides no documented atomic compare-and-swap: the preflight, immediate pre-write check and post-write verification detect many concurrent changes but cannot eliminate that final race or provide a fleet-wide transaction. Coordinate production policy changes accordingly.

## Mocked Data

All policy-related SSH destinations are forced to **127.0.0.1:2222**, independently of the configured proxy/central server, and do not use a proxy tunnel. Appliance reads/installations use the shared dummy startup command. The included [`local-policy.ps1`](../scripts/ssh-dummy/local-policy.ps1) extends the existing dummy with `show sources policy local`, arbitrary `inline policy local <delimiter>`, multiline source retention, compiler `ok`/errors and persistent readback. Copy it next to `dummy.ps1`, dot-source it before the command loop (`. "$PSScriptRoot\local-policy.ps1"`), and insert `if (Invoke-DummyLocalPolicyCommand $command) { continue }` after trimming the command, before the existing handlers. It reuses the dummy’s privilege flags and contains no credentials. `DUMMY_COMPILE_ERROR` exercises rejection. All sessions share one dummy appliance; a multi-proxy census aimed at that same fixture may report conflicts after its first replacement, correctly detecting that the common remote source changed. The old backup-only dummy does not implement these policy commands and will correctly report errors until extended. Central file operations execute the configured POSIX/PowerShell scripts on the SSH server itself, without launching the appliance dummy.

Automated tests use isolated loopback SSH fixtures and temporary files with synthetic credentials. They cover interactive enable, large multiline uploads through a small SSH window, complete readback, compiler rejection, exact-byte central saves and stale-edit rejection. No production policy is deployed by the test suite. PowerShell scripts and real SGOS behavior still need acceptance testing on the actual Windows/server/appliance environment.

## Broadcom references

- [View source policy files](https://knowledge.broadcom.com/external/article/167669/how-to-view-the-policy-files-on-your-pro.html): documents configuration-mode `show sources policy` and distinguishes source files from combined policy. The proposed `http://PROXY:8080/local_policy_source` is not assumed to be a configured management endpoint; SSH avoids a separate HTTP authentication/port assumption.
- [Modify Local Policy using CLI](https://knowledge.broadcom.com/external/article/419715/modifying-local-policy-file-using-cli.html): `inline policy local EOF` **overwrites** the existing Local Policy, so edits must include the complete desired file.
- [Write CPL rules](https://knowledge.broadcom.com/external/article/166537/how-to-write-rules-using-cpl-with-exampl.html): layer/rule/definition examples.
- [Policy evaluation order](https://knowledge.broadcom.com/external/article/166764/policy-file-evaluation-order.html): source ordering can be configured and later policy files can override earlier settings. The editor preserves ordering rather than inferring a global first-match rule.
- [Restore/migrate policy files](https://knowledge.broadcom.com/external/article/166865/restoring-or-migrating-policy-files-betw.html): VPM requires its CPL and XML sources; Local Policy is a separate source. CPL alone does not reconstruct a VPM project.
- [Edge SWG 7.3: Writing CPL](https://techdocs.broadcom.com/us/en/symantec-security-software/web-and-network-security/edge-swg/7-3/overview4/writing_CPL.html): version-specific syntax reference supplied for this feature. Automated access returned HTTP 403 during implementation; no claim is made to have validated the entire 7.3 grammar against that inaccessible page.

## Validation of the guided editor and shared sources

Frontend checks use TypeScript `--noEmit`, Biome and Playwright against a Next development server. Pure model tests cover typed criteria, IPv4/IPv6 validation, negation, preserved spaced calls, compound dependencies, cycles, large-object edits, comments/EOL preservation, object renaming and the shared JSON schema. Browser tests cover the guided client/destination/action flow, contextual cells, typed list creation, nested condition inspection, shared-object acknowledgement, imports/exports, source configuration and existing distribution safeguards.

Rust source includes tests for shared-envelope metadata preservation, legacy setting defaults and HTTPS configuration restrictions. Native compilation and these native tests were not executed in this Linux session, per the instruction not to build the application here. Windows/native networking, remote PowerShell scripts and actual SGOS acceptance still require validation in their target environments.
