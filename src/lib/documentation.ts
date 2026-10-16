type Section = {
  id: string;
  title: string;
  paragraphs?: string[];
  rows?: [string, string][];
};
type Topic = {
  title: string;
  description: string;
  sections: Section[];
};
export type DocumentationSlug =
  | 'proxies'
  | 'diagnostics'
  | 'trace'
  | 'traffic-analysis'
  | 'pac'
  | 'settings'
  | 'storage';

export const documentationTopics: Record<DocumentationSlug, Topic> = {
  proxies: {
    title: 'Home & proxies',
    description:
      'Manage appliances and select the workspace or diagnostic context.',
    sections: [
      {
        id: 'inventory',
        title: 'Register and recheck',
        paragraphs: [
          'Add an appliance by hostname or IP. The inventory prevents duplicate registrations. Rust sends four native ICMP probes with surge-ping and resolves hostnames through Tokio’s operating-system resolver. PTR queries use Hickory with the system DNS configuration. Windows falls back to IP Helper ICMP when raw socket access is denied. Any echo reply confirms reachability; this check does not verify HTTP login.',
          'Connectivity checks retain a known hostname when PTR lookup fails, even if ICMP succeeds and returns an IP as the display fallback. Loading the inventory recovers a lost display name from surviving stored identity fields or proxy-name diagnostics. A registered hostname survives failure. Once a successful check discovers a valid IP, that IP becomes the primary address for later checks. A supplied IP remains preserved.',
          'An IP-identified appliance without a known hostname shows an amber alert beside its name. Hover or focus it for the reverse DNS (PTR) lookup explanation. This indicates an unavailable hostname, not proof that a PTR record is missing: DNS connectivity, resolver configuration or a timeout may also prevent discovery. The IP remains usable; the alert disappears when a hostname becomes available.',
        ],
      },
      {
        id: 'tags',
        title: 'Tags and grouping',
        paragraphs: [
          'Use Edit tags in any proxy’s actions menu to create your own labels, assign existing labels or remove them. Tags are saved with the inventory and survive reachability checks. Names are trimmed and compared without case distinctions to avoid duplicate labels.',
          'Choose Group by → Tags to separate the inventory into named sections and an Untagged section. A proxy with multiple tags appears in each matching section. Show tag can restrict the inventory to one section. Grouping and the selected tag persist on this device; No grouping restores the flat inventory.',
        ],
      },
      {
        id: 'tools',
        title: 'Appliance actions',
        rows: [
          [
            'Diagnostics',
            'Read the selected appliance’s policy index and open Trace or Traffic Analysis. The proxy query parameter carries this context across static pages.',
          ],
          [
            'SSH connection',
            'Open an interactive shell with the saved SSH credentials. One persistent connection preserves enable/configuration context. The left history jumps to command output; blocks collapse and copy, while large output is paged and virtualized. Password challenges use hidden responses outside history. Disconnect explicitly; navigation keeps the session alive. Mocked SSH uses only 127.0.0.1:2222 and the shared dummy CLI.',
          ],
          [
            'Management console',
            'Open a separate WebView window. Windows WebView2 responds to HTTP Basic authentication challenges with the application credentials; credentials are not embedded in the URL. Windows WebView2 automatically accepts certificate errors for the initial management HTTPS origin. Other origins retain normal certificate validation; this is separate from Rust HTTP clients.',
          ],
        ],
      },
      {
        id: 'workspaces',
        title: 'Workspace switcher',
        paragraphs: [
          'The shared workspace selector navigates between /proxies and /pac while keeping the same layout. Home reopens the last selected workspace, defaulting to Proxies. PAC sources refer to the same registered proxy inventory; they do not create duplicate appliance records. Inventory and workspace selection persist in WebView localStorage.',
        ],
      },
    ],
  },
  diagnostics: {
    title: 'Diagnostics',
    description:
      'Policy discovery and the entry point for the selected proxy’s diagnostic tools.',
    sections: [
      {
        id: 'loading',
        title: 'What loading does',
        paragraphs: [
          'Live mode GETs https://<proxy-IP>:8082/Policy, extracts the supported policy and trace links, and downloads linked policy sources. The existing extraction patterns determine which sources are recognized; the application does not mirror the entire management website.',
          'Mock mode starts at http://127.0.0.1:5500/Policy.html. Relative policy links are resolved against that page. Missing linked mock policy files returning 404 are skipped because the fixture may not contain every advertised source; live failures are reported.',
        ],
      },
      {
        id: 'actions',
        title: 'Tools and navigation',
        rows: [
          [
            'Policy sources',
            'Inspect the retrieved policy text and use its identifiers when interpreting trace evaluation.',
          ],
          [
            'Trace',
            'Select a trace link discovered from the index. Trace is a separate transaction and policy evaluation workflow.',
          ],
          [
            'Traffic Analysis',
            'Open /Diagnostics/TrafficAnalysis?proxy=... to analyze access logs, independently of trace polling. Live access log discovery uses this selected proxy.',
          ],
        ],
      },
      {
        id: 'connection',
        title: 'Connection and errors',
        paragraphs: [
          'Rust sends configured Basic Auth credentials, uses an in-memory cookie jar, and accepts untrusted TLS certificates in the current management environment. Transport, HTTP and parsing failures appear in application toasts. A successful inventory ping does not guarantee port 8082, authentication, or linked files are available.',
          'The Mock/Live setting selects the endpoint. The application does not start the mock server. See Settings & connections for the shared transport contract.',
          'Policy data and available access-log indexes use a session-only HTML extraction cache, separated by selected proxy and Mock/Live mode. Reopening a page displays cached data immediately and revalidates in the background; window focus also revalidates, throttled to 30 seconds per mounted view. Identical results preserve the current data object. Cache entries expire after 30 minutes, with at most 16 entries and approximately 16 MiB of serialized UTF-16 content. Process exit discards the cache; no HTML extraction cache file is created.',
          'A bottom update notification and a smooth 96% opacity state leave existing content readable and interactive during refresh. Network failures retain previously displayed data with an error toast; HTTP 401/403 discard the affected cached result. Cache invalidation never deletes captured logs or processed analysis files. PAC sources keep their own persisted synchronization/conflict model rather than sharing this read-only discovery cache.',
        ],
      },
    ],
  },
  trace: {
    title: 'Trace',
    description:
      'Collect request transactions and inspect the policy evaluation that produced each result.',
    sections: [
      {
        id: 'collection',
        title: 'Collection',
        paragraphs: [
          'Rust polls the selected trace URL every five seconds using Basic Auth, an in-memory cookie jar and the existing TLS certificate bypass. It validates the URL against the selected proxy context. Mock mode uses the local origin, including /Policy/Trace/etuyon.html.',
          'New transactions are parsed in Rust, emitted through Tauri and appended to rawLogs.log and logs.jsonl under app_cache_dir(). Leaving Trace stops polling; the files remain and are not automatically rotated.',
        ],
      },
      {
        id: 'evaluation',
        title: 'Reading evaluation',
        rows: [
          [
            'Transaction / verdict',
            'Each record is a processing transaction, not necessarily a complete connection. The reported verdict is preserved and takes precedence over matched rules. If absent, only explicit matched actions are shown as inferred evidence; otherwise the result is Not reported. Missing checkpoints never mean unreachable. ALLOWED (handed off), CONNECT and TLS interception decisions do not prove network delivery.',
          ],
          [
            'Layers and Matches',
            'Policy layer headers define separate evaluation layers. A MATCH-prefixed Proxy header starts a layer; MATCH: condition=... remains an internal match. Guard conditions stay attached to their layer.',
          ],
          [
            'Misses',
            'Reported checks that did not match. The button on the Matches heading collapses or shows misses globally without deleting data or changing evaluation.',
          ],
          [
            'Details',
            'Open expanded transaction details, the exact original raw block, policy rules and every recorded checkpoint for this processing type. Null checkpoints are omitted and zero-millisecond measurements remain visible. No client-out stage is invented.',
          ],
        ],
      },
      {
        id: 'scope',
        title: 'Scope',
        paragraphs: [
          'Explicit handoff IDs connect only unambiguous captured transactions; references outside the capture are labeled as missing and no relationship is inferred from adjacency or a matching URL. UTC timestamps are parsed explicitly and displayed in UTC; custom filter inputs use local time. Missing or invalid timestamps are labeled Not recorded and excluded from time-range filtering.',
          'Group by → Related flow keeps transactions connected by explicit handoff references together. Groups and their member transactions sort by their latest recorded activity first. Equal timestamps show the latest processing stage first, while missing timestamps appear last. Explicit handoff relationships and hierarchy are preserved independently of display order. First record and Last record show the captured timestamp range, not proof of connection creation or closure. Missing parents are labeled as uncaptured references, and ambiguous or cyclic references are identified without fabricating an origin. Grouping persists on this device; each flow can be collapsed independently. Filters show only matching records while preserving their full-capture group and total outcome counts.',
          'The transaction list uses TanStack Virtual with measured row heights for both flow headers and individual transactions; even a single large expanded flow remains virtualized. Search, verdict filters, totals and handoff lookup use all received records, including rows outside the rendered window. Raw and parsed records still consume memory proportional to capture size; virtualization limits DOM work, not the amount of retained trace data.',
          'Trace explains individual request processing. Traffic Analysis aggregates access log traffic; its request counts are not counts of policy layers or trace matches. The parser supports the trace formats observed by this project, not every possible SGOS trace format.',
        ],
      },
    ],
  },
  'traffic-analysis': {
    title: 'Traffic Analysis',
    description:
      'Analyze the entire captured access log, identify traffic drivers, and inspect the underlying records.',
    sections: [
      {
        id: 'sources',
        title: 'Static Log and Live Session',
        paragraphs: [
          'Static Log accepts one or multiple ELFF files and processes them in selection order into one capture. Each file has an independent #Fields schema and UTF-8 decoder; file boundaries never join records or inherit another file’s schema. Original filenames remain on records and diagnostics. Overall progress spans all selected files. If any file fails, the incomplete capture is discarded. Files use 8 MiB blocks with one-block prefetch while Rust tokenizes records in parallel. Auto uses up to eight workers; manual selection is bounded by detected processors and sixteen workers. Bundled samples are offline fixtures.',
          'Live Session discovers log names from http://127.0.0.1:5500/Accesslog/tail-f.html in Mock mode and opens /Accesslog/tail-f/<name>.html. Live mode uses https://<proxy-IP>:8082/Accesslog/tail-f and /Accesslog/tail-f/<name>, without .html. The selected proxy and configured credentials are used.',
          'Rust consumes each HTTP chunk without waiting for the response to finish. Plain ELFF or HTML <pre> content feeds the same schema-driven parser as uploads. Metadata updates arrive at approximately 500 ms intervals; dashboard queries refresh about once a second after the previous query completes. Finite mock responses are analyzed once, without fabricated dates or replay.',
          'Stop cancels acquisition and waits for received complete records and counters to finish persisting. Save capture is then available, as it is after a finite response ends or a static upload completes. Restart starts a separate capture. Save before replacing the source or leaving the page to keep the current capture.',
        ],
      },
      {
        id: 'schema',
        title: 'Schema, raw data and availability',
        paragraphs: [
          '#Fields is authoritative: every value maps to its declared field name, respecting quotes. Unknown fields are preserved. Main and SSL schemas may differ or change during the capture. Raw fields and independent normalized fields remain available together.',
          'A token-count mismatch marks the row malformed and records expected/received counts, source, raw line and error type. Following rows continue processing; missing values are not shifted into invented positions. Without a schema, lines produce diagnostics rather than invented records.',
          'Raw -, *, None, unavailable and empty values remain distinct. Field availability reports whether a field is absent, present without useful data, or populated. The coverage table describes the entire capture, independent of time filters. Empty rankings indicate unavailable usable values, not an invented zero-valued category.',
        ],
      },
      {
        id: 'scope',
        title: 'Complete capture, time range and counters',
        paragraphs: [
          'Each ingestion transaction writes every parsed record, updates global request/byte counters and dimension rankings, and persists minute timeline buckets in a local SQLite capture. Global analytics read those counters instead of recounting raw records. There is no 5,000-record analytical retain limit.',
          'A selected range or additional filters query indexed timestamps and typed columns in the complete capture. These queries aggregate the matching rows; they do not reread the original file or reparse ELFF. A bounded, revision-aware cache reuses range analytics across pagination and invalidates when ingestion changes the capture. During ingestion, “entire capture” means everything processed so far.',
          'Changing a range, filter or analytical view immediately shows a calculation indicator. Existing statistics and record pages remain visible with a subtle opacity transition and a bottom notification until the new selection finishes. They still represent the previous completed query while the update indicator is visible. First-time queries show a placeholder only when no prior analysis exists for that capture. Wide ranges and compound filters can take longer because they aggregate indexed records; stored timestamps retain exact record-level temporal precision.',
          'The timeline appears above every view, including Errors & Security and Fields & Records. Request-density colors identify quiet and busy intervals. Use its slider or click a density cell to select a range. Expand Range at the bottom right of Capture Timeline for exact inclusive UTC bounds and recent-period presets. Filters has its own card below the timeline and expands independently from its full header; Clear filters does not toggle it. The UTC Time Zone card sits beside the capture source controls. Collapsing Range or Filters keeps all selections applied. Recent presets count back from the last captured minute. Records without a valid timestamp count in All time but cannot match a bounded time range.',
          'Apache ECharts runs through echarts-for-react, loaded only in the browser. The Overview uses columns for requests or bytes over time, with the application’s theme colors and a fixed 4 px gap. Columns fill the available plot width; bucket count adapts on resize, up to 120 equal-duration buckets, while quiet intervals keep their time slots. The full-capture navigator uses up to 160 request-density cells: actual observed minimum is light gray (#dddddd), arithmetic midpoint yellow, and maximum dark red, with linear interpolation. Inserted quiet intervals remain light gray and do not force the observed minimum to zero; constant data stays light gray and is labeled “No variation.” The density strip is 22.5 px high, and its white range selector is 11 px high. Tooltips show exact bucket counts and time spans. These display buckets do not reduce the accuracy of native range queries. Display time zone changes labels only; stored timestamps and entered bounds remain UTC.',
        ],
      },
      {
        id: 'metrics',
        title: 'Metrics and rankings',
        rows: [
          [
            'Total requests',
            'Number of parsed records in the current analytical selection, including flagged malformed records. Header lines and unparsed pre-schema lines are not requests.',
          ],
          [
            'Traffic volume',
            'Sum of usable, nonnegative cs-bytes + sc-bytes. Unreported bytes remain missing. This is recorded traffic volume, not necessarily physical wire utilization.',
          ],
          [
            'Average requests/s and throughput',
            'Selected request/byte totals divided by the explicit time range, or first-to-last timestamp when bounds are absent; minimum duration one second. Without usable timestamps, rates are unavailable. These are averages, not instantaneous rates.',
          ],
          [
            'Unique users / clients / destinations',
            'Distinct usable cs-username / c-ip / cs-host values in the selection. Zero with an unpopulated field does not establish that no clients or users exist.',
          ],
          [
            'Top Sites / Users / Clients / Categories / Applications',
            'Rank by recorded request count or bytes. A site entry of 300 requests means 300 matching records for that host. Top 10/20/30/50 controls display size, not the capture or denominator.',
          ],
          [
            'Percentages',
            'Entry requests or bytes divided by the selection total. Multi-category records count in each category; issue classes can overlap, so those percentages need not sum to 100%.',
          ],
          [
            'Requests with issues',
            'Distinct selected records with at least one detected issue. Issue rankings count records per issue class, not additional requests.',
          ],
          [
            'Denied transactions',
            'Records with a DENIED/BLOCKED transaction signal or an explicit access security policy denial. Each record counts once; the cause is not automatically attributed to a policy rule.',
          ],
        ],
      },
      {
        id: 'filter-results',
        title: 'Filter results are not verdicts',
        rows: [
          [
            'OBSERVED',
            'A category lookup occurred during policy evaluation. This does not mean the request failed or was blocked.',
          ],
          [
            'PROXIED',
            'Category was not a factor in the reported filtering result. This value is informational, not an error signal.',
          ],
          [
            'DENIED',
            'The request was not served, commonly because of an exception. Inspect action, status and exception to determine why; it is not proof of a policy block.',
          ],
          [
            's-action versus sc-filter-result',
            's-action reports transaction/cache handling; sc-filter-result reports filtering context. HTTP status is a third, separate signal. The dashboard retains all three.',
          ],
        ],
      },
      {
        id: 'issues',
        title: 'Errors & Security',
        paragraphs: [
          'Issue detection uses explicit signals: HTTP 407/authentication failure exceptions; other HTTP 4xx; HTTP 5xx or FAILED/ERROR actions; denied transactions; explicit policy denial; meaningful proxy exceptions; SSL/certificate, OCSP and ICAP failures; virus/threat IDs; populated error fields; and malformed records.',
          'OBSERVED, PROXIED, healthy certificate details and ordinary ICAP metadata are not automatically errors. Threat risk is a distribution, not proof of malware. These classifications are diagnostic clues, not a complete SGOS incident taxonomy; expand raw fields to establish the cause.',
          'The issue rankings use the selected time range and filters. The record table shows all matching records with an issue, using pagination. Its timeline remains the full-capture navigator so other periods can be selected.',
        ],
      },
      {
        id: 'records',
        title: 'Fields & Records and pagination',
        paragraphs: [
          'All matching records are accessible in chronological UTC timestamp order, with ingestion order as a tie-breaker. Choose 50/100/250/500 per page, Previous/Next, a page number, or Record # to locate the page containing a selected ordinal. This ordinal refers to the current filtered list, not an original source-file line number.',
          'Expand a record to inspect its original line, raw fields, normalized fields and issue annotations. Pagination limits only data sent to React, not totals or rankings. Parser diagnostics show the latest 100 details with the full diagnostic count; malformed parsed records remain accessible in the complete record table.',
        ],
      },
      {
        id: 'saving',
        title: 'Save and reopen',
        paragraphs: [
          'Save capture retains the complete SQLite database: records, diagnostics, counters, dimensions, timestamps, schema coverage and metadata. Multiple uploaded logs share the same capture and are saved together in one database file, using the existing save format. Load saved capture reuses the index without reading the source files. After Live Session Stop, the same save/load workflow applies.',
          'Existing JSON/JSONL captures remain supported: first opening them indexes their processed record archive into SQLite, without reparsing ELFF. Subsequent opens use SQLite. Saved captures are local, unencrypted, and not automatically expired. See Files & local storage for actual runtime paths.',
        ],
      },
    ],
  },
  pac: {
    title: 'PAC File Manager',
    description:
      'Manage PAC/WPAD sources separately from their visual routing editor.',
    sections: [
      {
        id: 'sources',
        title: 'Sources and synchronization',
        paragraphs: [
          '/pac lists registered PAC sources, origin URLs, connection/sync state, last synchronization and rule counts. Open a source or create one from scratch to navigate to /pac/editor?sourceId=... or /pac/editor?new=1. These are static routes with query parameters.',
          'Synchronization GETs the source URL and compares content hashes against the baseline. States distinguish synchronized, local changes, remote changes, conflict and offline. A remote change with local edits is preserved for explicit handling, not silently substituted. Arbitrary PAC JavaScript that cannot be safely interpreted stays read-only with its original content available.',
        ],
      },
      {
        id: 'rules',
        title: 'Rules and order',
        paragraphs: [
          'Each rule is condition → ordered destination(s). Match types include domains, hosts, URL patterns, starts/ends/contains, regex, IPv4/IPv6 and CIDR, and advanced PAC boolean expressions. Inputs and validation follow the selected type; bulk input creates rules from newline-separated values.',
          'Rules stay compact until explicit editing. Groups are collapsible ordered containers; moving a group moves all its rules while preserving their internal order. Individual rules can be reordered within a group. The generated PAC evaluates the ordered rules in sequence: the first matching return wins, then the fallback applies.',
          'Destinations reuse registered proxies, including supported PROXY/HTTP/HTTPS/SOCKS/SOCKS4/SOCKS5 directives and DIRECT. Proxies are not duplicated in PAC storage. IPv6 generation uses FindProxyForURLEx/isInNetEx, requiring compatible clients.',
        ],
      },
      {
        id: 'tools',
        title: 'Testing, preview and publishing',
        rows: [
          [
            'Test URL',
            'Evaluate supported conditions and report the first matching route. Browser-side preview does not resolve DNS or execute custom PAC expressions; such cases are uncertain.',
          ],
          [
            'Generated PAC Preview',
            'Open the modal to inspect generated code. Visual configuration remains separate from the generated JavaScript.',
          ],
          [
            'Publishing',
            'Export/download the PAC and deploy it using the server’s own mechanism. The application does not PUT/POST to a WPAD URL; reading a URL does not establish write permission.',
          ],
          [
            'Remote loading',
            'Rust downloads HTTP(S), follows redirects, accepts untrusted certificates and limits PAC content to 512 KiB. No application credentials are attached. Mock/Live does not redirect PAC sources.',
          ],
        ],
      },
    ],
  },
  settings: {
    title: 'Settings & connections',
    description:
      'Connection profiles, credentials, updates and appearance in a responsive settings dialog.',
    sections: [
      {
        id: 'overview',
        title: 'Settings workspace',
        paragraphs: [
          'Open Settings from the navigation bar. Data source and Appearance & privacy are grouped together; Proxy credentials and Application updates have their own sections. The dialog uses two columns on larger screens and a single column on smaller screens, with scrolling content and a fixed header and footer. Save credentials and tokens in their respective sections; switches take effect immediately. Done, the close button or Escape closes the dialog.',
        ],
      },
      {
        id: 'mode',
        title: 'Mock and Live',
        paragraphs: [
          'Live proxy data is the default. Enable Mocked data in Settings to use development fixtures without a credential prompt in Diagnostic tools. The persisted source switch affects Diagnostics, Trace, Traffic Analysis Live Session and Backup Manager. Mocked SSH backups connect exclusively to 127.0.0.1:2222 with the saved credentials; a local OpenSSH server and the configured dummy script are required. Static Log uploads remain local. Home ping/DNS checks and PAC source downloads are independent of this switch.',
          'Mock uses the local development server at http://127.0.0.1:5500; the app neither bundles nor starts it. Policy starts at /Policy.html, the sample trace is /Policy/Trace/etuyon.html, and access logs use /Accesslog/tail-f.html plus /Accesslog/tail-f/<name>.html. Live management uses the selected proxy on HTTPS port 8082, without mock .html suffixes.',
        ],
      },
      {
        id: 'credentials',
        title: 'Credentials and TLS',
        paragraphs: [
          'Live username/password are stored in Windows Credential Manager as proxytools/management-credentials, protected for the current Windows user on this machine. In Mocked Data, saved credentials use the separate mock-management-credentials localStorage entry; mock startup, saving and deletion do not access the Windows vault. Switching modes selects separate credentials without copying live credentials to localStorage. At startup, legacy plaintext localStorage credentials are migrated only after a successful vault write, then removed; legacy temporary credentials are discarded. New temporary credentials stay in memory and are cleared on Home or process exit. If secure startup fails, Retry or continue without stored credentials; legacy plaintext is retained until migration succeeds. The UI holds credentials in memory for forms and passes them through Tauri IPC; they are never included in cache keys, logs or URLs. Persistent credential saving on other platforms is not implemented.',
          'Rust policy, trace, traffic and PAC HTTP clients accept untrusted TLS certificates in the current environment. Policy/trace/traffic share native connection pools and cookie jars, isolated by exact origin and credential identity. The manager retains at most 16 entries, evicts idle entries after 15 minutes when accessed, honors server cookie expiry and rejects redirects outside the selected origin. Basic Auth is sent preemptively on each live HTTP request: there is no separate login request, bearer token or refresh-token flow. HTTP 401 discards the rejected session client/cookie jar, suppresses the same origin/credential combination for 30 seconds, and stops Trace polling instead of repeatedly submitting rejected credentials; update credentials and reopen Trace to resume. Credential changes/deletion and source-mode switches clear the pool and scraping cache. PAC requests do not attach proxy credentials. Mock HTTP requests never carry management credentials. Backup Manager is an explicit exception: mocked SSH backups authenticate against 127.0.0.1:2222 using the saved credentials and run the local dummy CLI.',
          'Management console windows use native WebView2 ServerCertificateErrorDetected and BasicAuthenticationRequested handling on Windows. Certificate errors are automatically accepted for the initial HTTPS origin, without checking certificate fingerprints; other origins retain normal validation. Rust request settings do not override this separate WebView handling. The native authentication challenge callback supplies credentials only to the initial HTTPS origin; close console windows to discard their separate browser authentication state.',
        ],
      },
      {
        id: 'timeouts',
        title: 'Traffic stream behavior',
        paragraphs: [
          'Live HTTP bodies have no total or idle timeout: a quiet open stream is still connected. Connection setup has a 15-second deadline; response headers and finite index reading have 30-second deadlines. The index is limited to 2 MiB, individual log lines to 1 MiB, and oversized HTML tags are rejected. UTF-8 is required.',
          'HTTP, authentication and parser errors appear in the stream status and toasts. Ended responses retain their processed capture for inspection and saving; Start/Restart creates a new capture. Stop waits for persistence before enabling Save.',
        ],
      },
      {
        id: 'preferences',
        title: 'Local preferences',
        rows: [
          [
            'Display time zone',
            'Traffic Analysis labels default to UTC; the selected IANA zone persists locally and respects daylight saving. Raw timestamps remain UTC.',
          ],
          [
            'Processing workers',
            'Auto or a manual native parser worker count persists locally. Acquisition blocks preserve schema and file order even when tokenization is parallel.',
          ],
          [
            'Theme',
            'Dark-mode settings and theme-provider preferences are stored locally.',
          ],
          [
            'Delete on close',
            'This preference is stored but currently has no close handler that performs cleanup. Temporary credential removal occurs when Home mounts.',
          ],
        ],
      },
    ],
  },
  storage: {
    title: 'Files & local storage',
    description:
      'What the application writes, where it writes it, and when data is retained.',
    sections: [
      {
        id: 'paths',
        title: 'Actual runtime cache paths',
        paragraphs: [
          'These paths are queried from app.path().app_cache_dir() in the running Tauri application. The browser preview cannot resolve desktop paths; no workstation directory is assumed or hardcoded.',
        ],
      },
      {
        id: 'files',
        title: 'Native files and lifecycle',
        rows: [
          [
            'rawLogs.log / logs.jsonl',
            'Trace appends original trace data and parsed transaction JSONL. Files remain after navigation, without automatic rotation or deletion.',
          ],
          [
            'traffic-analysis/<id>.sqlite',
            'Full raw/normalized records, diagnostic annotations, all parser diagnostics, counters, dimension memberships, minute timeline, timestamp indexes, schema coverage and source metadata. Both static and HTTP captures use this format. It may be larger than the source log.',
          ],
          [
            '<id>.sqlite-wal / <id>.sqlite-shm',
            'SQLite working files during ingestion and concurrent reads. Save marks a completed capture retained and checkpoints its database; the remaining working files follow SQLite’s connection lifecycle.',
          ],
          [
            'Unsaved captures',
            'Replacing a source, leaving the page or aborting cleans up unsaved SQLite captures and their working files. Cleanup is best effort: abnormal shutdown or files still held by the OS can leave cache artifacts. They are not listed as saved captures.',
          ],
          [
            'Saved captures',
            'Remain local and reopen without source-file parsing. They are not encrypted or automatically expired. Save is available only after static completion or confirmed stream completion/Stop.',
          ],
          [
            'Legacy <id>.json + <id>.jsonl',
            'Existing processed captures are preserved. First opening indexes the full JSONL archive into SQLite; later opens use that database.',
          ],
          [
            'PAC exports',
            'Download a .pac file through the WebView; Windows/WebView2 chooses the download location. The app does not write back to the remote source.',
          ],
          [
            'SSH console output',
            'ssh-<session-id>/<command-index>.txt under the existing app cache. Session history lasts for this app run; Remove session deletes its cached output after disconnection. Secret responses are redacted, but command/configuration output can contain sensitive information.',
          ],
          [
            'Uploaded logs',
            'Read locally; original source files are not modified. Processed captures stay under the application cache, not beside the uploaded file.',
          ],
          [
            'Development artifacts',
            '.next/, dist/ and src-tauri/target/ are build artifacts, not user captures. Existing native parser tests use temporary proxytools-parser-*.jsonl and proxytools-traffic-test-* files in the OS temp directory.',
          ],
        ],
      },
      {
        id: 'authentication-storage',
        title: 'Authentication and discovery storage',
        rows: [
          [
            'Windows Credential Manager',
            'Target proxytools/management-credentials in the current user account on this computer. Windows manages encryption and storage; this is not a file under app_cache_dir(). Settings Delete removes this entry.',
          ],
          [
            'Temporary credentials / HTTP sessions',
            'Process memory only. Cookies respect server expiry. Native pools are bounded and invalidated on authentication rejection, credential changes or data-source switches. External console windows have separate WebView authentication state.',
          ],
          [
            'HTML extraction cache',
            'Process memory only, shared across navigation for policy discovery and access-log indexes. Maximum 16 entries / approximately 16 MiB serialized text; 30-minute expiry. Reopening revalidates without hiding cached content.',
          ],
        ],
      },
      {
        id: 'local-storage',
        title: 'WebView localStorage',
        rows: [
          [
            'proxies',
            'Inventory, appliance identity, last reachability state, ping and DNS output.',
          ],
          [
            'Legacy credentials / one-time-credentials',
            'Legacy entries are removed during secure startup migration. Saved credentials now use Windows Credential Manager; temporary credentials and authentication sessions stay in memory.',
          ],
          [
            'pac-sources',
            'PAC origins, visual rules, baseline content/version, sync state and pending remote content.',
          ],
          [
            'data-source-mode',
            'Persisted Mock/Live management source.',
          ],
          [
            'home-workspace / pac-selected-source',
            'Selected workspace and PAC source.',
          ],
          [
            'traffic-analysis-timezone / traffic-analysis-workers',
            'Display zone and native worker preferences.',
          ],
          [
            'dark_mode / delete_on_close',
            'Settings preferences; the theme provider may also keep its own preference. Delete on close does not currently clean captured files.',
          ],
        ],
      },
      {
        id: 'boundary',
        title: 'Local and remote boundaries',
        paragraphs: [
          'WebView storage is managed by the Tauri/WebView runtime rather than separate application JSON files. Proxy checks run local OS commands; management data and PAC sources require outbound HTTP. Static parsing, queries, charts and saved captures run locally. The application provides no remote upload or publication for captured logs.',
        ],
      },
    ],
  },
};
