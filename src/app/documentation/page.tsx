import {
  Activity,
  BookOpen,
  Database,
  FileCode2,
  FolderClosed,
  Globe,
  HardDrive,
  KeyRound,
  Network,
  ShieldAlert,
} from 'lucide-react';
import type { Metadata } from 'next';
import ResolvedCacheDirectory from '@/components/resolvedCacheDirectory';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Documentation | Proxy Tools',
  description:
    'Architecture, storage, and network activity of Proxy Tools.',
};

const localKeys = [
  [
    'proxies',
    'Proxy inventory, identity, last reachability result, ping and DNS output.',
  ],
  [
    'credentials',
    'Saved username and password. Stored as JSON; the app does not encrypt this value.',
  ],
  [
    'one-time-credentials',
    'Temporary login credentials. Cleared when Home mounts, not when the window closes.',
  ],
  [
    'pac-sources',
    'PAC source URLs, visual rules, base version, sync state, and pending remote content.',
  ],
  [
    'data-source-mode',
    'Mock or Live mode for Diagnostics and Trace. Traffic Analysis has its own Static Log and mock Live Stream modes.',
  ],
  [
    'home-workspace',
    'The selected Home workspace: Proxy or PAC Manager.',
  ],
  ['pac-selected-source', 'The selected PAC source.'],
  [
    'traffic-analysis-timezone / traffic-analysis-workers',
    'Traffic Analysis display time zone (UTC by default) and parser worker preference (Auto by default).',
  ],
  [
    'dark_mode / delete_on_close',
    'Settings preferences. delete_on_close is stored but currently does not trigger close-time cleanup.',
  ],
];

export default function DocumentationPage() {
  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6'>
      <header className='border-b pb-5'>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <BookOpen className='size-4' /> System documentation
        </div>
        <h1 className='mt-2 text-2xl font-bold tracking-tight md:text-3xl'>
          Proxy Tools at a glance
        </h1>
        <p className='mt-2 max-w-3xl text-sm text-muted-foreground'>
          A compact map of screens, local data, files, and network
          activity. The UI runs in Tauri; operating system tasks and
          HTTP requests run in Rust.
        </p>
      </header>

      <section
        className='grid gap-4 md:grid-cols-3'
        aria-label='Application overview'
      >
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Network className='size-4 text-primary' />
              Proxy Workspace
            </CardTitle>
          </CardHeader>
          <CardContent className='text-sm text-muted-foreground'>
            Registers appliances, preserves their identity, checks
            reachability, and opens management tools.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <FileCode2 className='size-4 text-primary' />
              PAC File Manager
            </CardTitle>
          </CardHeader>
          <CardContent className='text-sm text-muted-foreground'>
            The Home workspace manages PAC sources. Select a source or
            create one from scratch to open its dedicated editor,
            which edits supported rules, detects conflicts, and
            exports a generated PAC file. It can also create a local
            PAC from scratch with a DIRECT fallback. Rules can be
            organized into groups and filtered without changing global
            evaluation order; groups move as ordered blocks while
            rules retain their order within each group. Groups can be
            collapsed to reduce the visible list. The editor keeps
            rule creation, routing, URL testing, publishing guidance
            and a modal PAC preview together, separate from source
            registration. Conditions include domains, hosts, URL
            patterns, string matching, regex, IPv4/IPv6 addresses and
            CIDR networks, plus custom PAC boolean expressions. IPv6
            output uses FindProxyForURLEx/isInNetEx, whose support
            depends on the client. Rules support ordered PAC fallback
            destinations (DIRECT, PROXY, HTTP, HTTPS, SOCKS, SOCKS4
            and SOCKS5) using registered proxies. URL preview cannot
            resolve DNS or execute custom PAC expressions, so those
            cases are marked uncertain. Rules can be added singly or
            from newline-separated bulk input and stay compact until
            edited. The editor generates the common if/return PAC
            structure; arbitrary JavaScript that it cannot safely
            interpret remains preserved and read-only. Remote sources
            remain read-only and are never published by the app.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Activity className='size-4 text-primary' />
              Diagnostics &amp; Trace
            </CardTitle>
          </CardHeader>
          <CardContent className='text-sm text-muted-foreground'>
            Reads an appliance’s policy index, then polls a selected
            trace URL for transactions and policy results.
          </CardContent>
        </Card>
      </section>

      <section className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Globe className='size-4' />
              Application routes
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <div>
              <Badge variant='outline'>/</Badge>
              <p className='mt-1 text-muted-foreground'>
                Home and the Proxy/PAC workspace switcher. PAC rules
                refer to the existing proxy inventory.
              </p>
            </div>
            <div>
              <Badge variant='outline'>/pac?sourceId=...</Badge>
              <p className='mt-1 text-muted-foreground'>
                Static Tauri-compatible editor route. Use
                ?sourceId=... to edit a saved PAC source or ?new=1 to
                create one from scratch. Source records and rules
                persist in local browser storage; remote PAC sources
                are fetched for reading and exported locally because
                publication is not implemented.
              </p>
            </div>
            <div>
              <Badge variant='outline'>/Diagnostics?proxy=...</Badge>
              <p className='mt-1 text-muted-foreground'>
                Loads policy files and available trace links from the
                selected proxy.
              </p>
            </div>
            <div>
              <Badge variant='outline'>
                /Diagnostics/Trace?proxy=...&amp;traceUrl=...
              </Badge>
              <p className='mt-1 text-muted-foreground'>
                Starts trace collection; Rust validates that the trace
                belongs to the selected proxy.
              </p>
            </div>
            <div>
              <Badge variant='outline'>
                /Diagnostics/TrafficAnalysis?proxy=...
              </Badge>
              <p className='mt-1 text-muted-foreground'>
                Parses uploaded ELFF access logs and a simulated
                incremental stream using each log’s #Fields schema. It
                presents traffic trends, KPIs, rankings, issue
                signals, schema coverage, and malformed-line
                diagnostics. This initial release is mock-only for
                Live Stream and does not connect to appliance
                access-log endpoints.
              </p>
            </div>
            <div>
              <Badge variant='outline'>/documentation</Badge>
              <p className='mt-1 text-muted-foreground'>
                This guide.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <HardDrive className='size-4' />
              Local browser storage
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <p className='text-muted-foreground'>
              These values use the Tauri WebView’s{' '}
              <code>localStorage</code>; the app does not write
              separate JSON files for them.
            </p>
            <dl className='divide-y'>
              {localKeys.map(([key, description]) => (
                <div
                  key={key}
                  className='grid gap-1 py-2 sm:grid-cols-[190px_1fr]'
                >
                  <dt className='font-mono text-xs'>{key}</dt>
                  <dd className='text-muted-foreground'>
                    {description}
                  </dd>
                </div>
              ))}
            </dl>
            <p className='pt-1 text-xs text-muted-foreground'>
              The theme provider may also keep its own theme
              preference.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <FolderClosed className='size-4' />
            Files, cache &amp; temporary data
          </CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 text-sm md:grid-cols-2'>
          <div>
            <h2 className='font-medium'>Resolved cache paths</h2>
            <p className='mt-1 text-muted-foreground'>
              The live path below is queried from{' '}
              <code>app.path().app_cache_dir()</code> on this running
              app—no guessed or hard-coded Windows path.
            </p>
            <div className='mt-2 rounded-md border bg-muted/30 p-3'>
              <div className='mt-1 break-all font-mono text-xs'>
                <ResolvedCacheDirectory />
              </div>
            </div>
            <p className='mt-2 text-xs text-muted-foreground'>
              These exact paths are queried from the running Tauri
              app. Trace files are created when Trace starts, appended
              to, and not automatically rotated or deleted.
            </p>
          </div>
          <div>
            <h2 className='font-medium'>
              PAC exports &amp; temporary files
            </h2>
            <p className='mt-1 text-muted-foreground'>
              Export downloads a <code>.pac</code> file through the
              WebView. Windows/WebView2 chooses the Downloads
              location; the app does not set a path or write back to
              the remote source.
            </p>
            <p className='mt-2 text-muted-foreground'>
              Traffic Analysis temporarily writes every parsed record
              and diagnostic to{' '}
              <code>traffic-analysis/*.pending</code>
              beneath the resolved cache directory. Replacing the log,
              leaving the page or aborting removes unsaved data; an
              abnormal shutdown can leave pending files. Rust parser
              tests briefly create{' '}
              <code>proxytools-parser-*.jsonl</code> and{' '}
              <code>proxytools-traffic-test-*</code> in the operating
              system’s temp directory, then delete it.
            </p>
            <p className='mt-2 text-xs text-muted-foreground'>
              Development/build artifacts are under{' '}
              <code>.next/</code>, <code>dist/</code>, and{' '}
              <code>src-tauri/target/</code>; these are not user data.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Database className='size-4' />
            Local and remote activity
          </CardTitle>
        </CardHeader>
        <CardContent className='grid gap-4 text-sm md:grid-cols-2'>
          <div className='space-y-3'>
            <div>
              <h2 className='font-medium'>
                Add &amp; recheck a proxy
              </h2>
              <p className='mt-1 text-muted-foreground'>
                Rust runs <code>ping.exe -n 4</code> and{' '}
                <code>nslookup.exe</code> locally. No HTTP request is
                made; the result is saved in the local proxy
                inventory.
              </p>
            </div>
            <div>
              <h2 className='font-medium'>Diagnostics</h2>
              <p className='mt-1 text-muted-foreground'>
                Live sends GET requests to{' '}
                <code>https://&lt;proxy&gt;:8082/Policy</code>, then
                to policy links found in its HTML. It also lists trace
                links. Saved credentials are sent as Basic Auth.
              </p>
            </div>
            <div>
              <h2 className='font-medium'>Management window</h2>
              <p className='mt-1 text-muted-foreground'>
                Opens the appliance in a separate WebView. On Windows,
                WebView2 supplies credentials to HTTP Basic
                challenges; credentials are not embedded in the URL.
              </p>
            </div>
          </div>
          <div className='space-y-3'>
            <div>
              <h2 className='font-medium'>Trace</h2>
              <p className='mt-1 text-muted-foreground'>
                Rust polls the selected trace URL every 5 seconds with
                Basic Auth and an in-memory cookie jar. New
                transactions are sent to the UI and appended to the
                two cache files. Leaving the page stops polling.
              </p>
            </div>
            <div>
              <h2 className='font-medium'>Traffic Analysis</h2>
              <p className='mt-1 text-muted-foreground'>
                Uploaded logs use 8 MiB blocks with one block
                prefetched while Rust parses rows in parallel. Auto
                reserves one logical processor when possible and uses
                up to 8 workers; manual selection supports up to 16,
                bounded by detected processors. Schema changes, split
                lines, and results preserve file order. Row and byte
                totals, field coverage, and the unfiltered timeline
                cover the entire file. Charts show up to 60 equal time
                intervals, including quiet periods. Filters, rankings,
                and the record table analyze the latest 5,000 rows.
                Progress and worker timings appear in diagnostic
                output. Mock Live Stream replays the bundled fixture;
                no real access-log endpoint is contacted in this
                phase.
              </p>
              <p className='mt-1 text-muted-foreground'>
                After an upload finishes, Save processed log retains
                every record (raw and normalized fields) and
                diagnostic in{' '}
                <code>traffic-analysis/&lt;id&gt;.jsonl</code> under
                the resolved cache directory;{' '}
                <code>&lt;id&gt;.json</code> stores a versioned
                summary, timeline, field coverage, and recent records.
                Load saved analysis restores this dashboard without
                reading or parsing the original log. These files
                remain local, are not encrypted or automatically
                deleted, and may be larger than the source log. Both
                files must stay together. Chart test sample provides
                eight anonymous requests across several minutes and
                hours.
              </p>
              <p className='mt-1 text-muted-foreground'>
                Log dates are interpreted as UTC. The saved display
                time zone applies to charts, peaks, record timestamps,
                and issue timestamps, including daylight saving
                changes. Raw log fields stay unchanged. Static time
                ranges count back from the latest retained log
                timestamp; Live Stream ranges count back from now.
              </p>
            </div>
            <div>
              <h2 className='font-medium'>PAC/WPAD</h2>
              <p className='mt-1 text-muted-foreground'>
                Downloads an HTTP(S) URL without credentials, follows
                redirects, and limits the response to 512 KiB. Content
                hashes detect remote changes. The app never PUTs/POSTs
                or publishes to the source.
              </p>
            </div>
            <div>
              <h2 className='font-medium'>Mock mode</h2>
              <p className='mt-1 text-muted-foreground'>
                Diagnostics loads{' '}
                <code>http://127.0.0.1:5500/Policy.html</code>. Trace
                loads{' '}
                <code>
                  http://127.0.0.1:5500/Policy/Trace/etuyon.html
                </code>
                , and mock trace links keep the same local origin.
                Diagnostics skips mock policy files that return 404
                because the local fixture may not include every link
                listed by the policy index. The sample server is not
                bundled or started by the app. Home reachability and
                PAC Manager do not use Mock mode. Traffic Analysis has
                its own bundled mock stream, separate from this HTTP
                fixture server.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className='border-amber-500/30'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <ShieldAlert className='size-4 text-amber-600' />
            Credentials &amp; current limitations
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm text-muted-foreground'>
          <p>
            <KeyRound className='mr-1 inline size-4' />
            Saved credentials are plain JSON in{' '}
            <code>localStorage</code>, without app-level encryption.
            The frontend passes them to Rust via Tauri commands. Live
            sends them to the proxy; Mock may send them over HTTP to
            the local sample service.
          </p>
          <p>
            Rust policy, trace, and PAC HTTP clients accept untrusted
            TLS certificates. The appliance WebView follows WebView2’s
            TLS behavior. The PAC editor only modifies logic it
            understands; unsupported PAC stays read-only to prevent
            dropping rules.
          </p>
          <p>
            <code>delete_on_close</code> is stored but no close
            handler currently reads it. Temporary credentials are
            removed when Home mounts, regardless of that preference.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
