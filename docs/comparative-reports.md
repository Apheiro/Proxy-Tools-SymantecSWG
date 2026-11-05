# Comparative Reports

Open **Diagnostic Tools → Comparative Reports** for the selected proxy/profile.
Only fully processed, saved SQLite v3 captures appear. No raw logs are downloaded,
read or reprocessed. Source connections are read-only; no migrations or caches are
written to the capture databases.

Captures created before proxy/profile attribution are visible only after explicitly
choosing **Browse unassigned legacy captures**. They retain **Unassigned** attribution.
Older v2/JSON archives are not silently reindexed. The existing Traffic Analysis
capture handling remains unchanged.

Choose full local days, Monday–Sunday calendar weeks, or a recurring same-day
hourly window. Event timestamps determine available dates, so missing calendar dates
are never inserted. Optional dates clip calendar weeks. Time windows use IANA zones,
24-hour clocks and half-open UTC spans, including disjoint spans when a DST clock
hour repeats. Daily/weekly modes ignore previous hour controls.

First/last event timestamps describe an **observed interval**, not certified log
coverage. Partial windows retain actual totals. The period chip shows requested and
observed bounds, endpoint-span estimate, occupied minutes and possible discontinuity.
Weeks display observed day counts. Eventless candidates are excluded and counted;
missing days are never zero-filled. Rates divide by elapsed observed span within the
requested UTC spans; one timestamp has no rate. The optional hourly common-clock
intersection requeries the database while preserving original totals.

Requests/Bytes and Top N changes requery all metric-dependent rankings. Common
clients/destinations are intersected over complete sets before truncation. Emerging
and disappeared entities compare complete sets between consecutive observed periods.
Unique entities are consolidated by value across sources. Missing field values are
omitted, and metadata availability is accessible under Sources & comparability.
HTTP 4xx/5xx, indexed parse failures, record issues and real indexed policy denials
are separate; counts can overlap. Unassigned ingestion diagnostics stay source-level.

Multiple sources are allowed only when their observed timestamp envelopes do not
overlap. V3 does not establish stable record identity across captures, so an unsafe
union is rejected with an explanation. This conservative check can reject legitimately
distinct captures whose ranges overlap. No user override can silently double count.

PDF uses the existing report font registration and PDF save/open commands. It includes
periods, requested/observed spans, rates, deltas, metric chart, rankings, common entities,
presence changes, original totals, source metadata and limitations. CSV exports summaries,
rankings, common/presence tables and original totals, with UTC timestamps and the
selected timezone/filters; spreadsheet formula prefixes are escaped.

Native commands: `list_traffic_comparison_captures`, `discover_traffic_comparison`,
`query_traffic_comparison`, `cancel_traffic_comparison`. Queries run off the UI thread,
use existing indexed projections and support SQLite interrupts. Bounds: 32 captures,
730 periods, 1,000,000 occupied discovery minutes, Top N 1–100 (UI 5/10/20/50).
The browser receives aggregates, not record pages.

Focused verification includes native SQL fixtures and a read-only comparison against
a saved local v3 capture, calendar/DST checks, synthetic PDF render review, and browser
bridge checks in `tests/e2e/comparative-reports.spec.ts`. The browser bridge test does
not substitute for launching the complete Tauri app.

## Exploring larger comparisons

The comparison panel uses a capture popover, segmented hourly/daily/weekly controls,
optional date filters, and a compact metric/Top N toolbar. The report timezone lives
in the header, with searchable IANA names and a local preference per proxy/profile.
Changing timezone, metric or Top N cancels outdated work and requeries the existing
indexed projections after a brief debounce. The previous immutable snapshot stays
visible, with its effective timezone and source count, until the replacement succeeds.
Errors/cancellation preserve it. Exports always use the displayed snapshot, including
while newer preferences are pending; the export tooltip identifies its timezone.

Period summaries show four cards per accessible page or all periods in a bounded
scrolling table. Global charts and exports retain all periods. Contributor rankings
show one or two explicitly chosen periods; common-set membership is still computed
across every observed period before Top N. Presence changes follow the ranking
period selection. All-period HTTP outcomes stay in their own scrolling table.

Activity aligns local clock positions: hourly bounds match the chosen window, daily
labels show HH:mm, weekly labels show weekday + HH:mm. UTC records and metric values
are unchanged. Each point retains a UTC identity and local UTC offset; repeated DST
clock times are never merged. Lines break at clock reversals/jumps and unoccupied
buckets. Six series are initially visible, with a scrollable interactive legend,
show-all control, period focus and horizontal zoom. Colors consistently identify a
period across cards, totals, curves and rankings.

Traffic increases use muted green text and decreases muted red text in cards, the
period table and findings. Neither direction means operational improvement/degradation.
Zero change, unavailable values and absent baselines are neutral; coverage context
remains visible beside each period.
