/** Self-contained, escaped report documents. No live DOM, scripts, URLs or chart runtime. */
import { formatBytes } from './trafficAnalysis';
import {
  COMPARISON_NOTE,
  comparisonCoverage,
  comparisonRate,
  type ComparisonEntry,
  type ComparisonPeriod,
  type ComparisonSnapshot,
} from './trafficComparison';
import type { ReportPalette, TrafficReport } from './trafficReport';

type Appearance = { theme: 'light' | 'dark'; palette: ReportPalette; exportedAt: string };
type Entry = Pick<ComparisonEntry, 'name' | 'requests' | 'bytes'>;
const LIMIT = 12;
const PERIOD_LIMIT = 64;
const SOURCE_LIMIT = 100;
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const number = (n: number | null | undefined) => n != null && Number.isFinite(n) ? nf.format(n) : 'Not available';
const bytes = (n: number | null | undefined) => n != null && Number.isFinite(n) ? formatBytes(n) : 'Not available';
const percent = (n: number, total: number) => total > 0 ? `${number(n / total * 100)}%` : 'No baseline';
/** Escape both text and quoted attributes, including control characters. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export const escapeAttr = escapeHtml;
// Bound individual labels without hiding that shortening occurred.
const text = (value: unknown) => {
  const s = String(value ?? 'Not available');
  return escapeHtml(s.length > 600 ? `${s.slice(0, 600)}… [label shortened]` : s);
};
const note = (s: string) => `<p class="note">${text(s)}</p>`;
const para = (s: string) => `<p>${text(s)}</p>`;
const section = (index: string, title: string, content: string, newPage = false) =>
  `<section${newPage ? ' class="new-page"' : ''}><div class="eyebrow">${text(index)}</div><h2>${text(title)}</h2>${content}</section>`;
const kpis = (items: [string, string][]) => `<div class="kpis">${items.map(([label, value]) =>
  `<div class="kpi"><div class="metric">${text(value)}</div><div class="caption">${text(label)}</div></div>`).join('')}</div>`;
const table = (headers: string[], rows: (string | number | null | undefined)[][]) => rows.length
  ? `<table><thead><tr>${headers.map(h => `<th>${text(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
    `<tr>${row.map(v => `<td>${text(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
  : note('No observations are available for this section.');
const disclosure = (shown: number, total: number, label = 'entries') =>
  note(`Showing ${number(shown)} of ${number(total)} ${label}. Rankings describe the returned aggregate, not every raw log record.`);
const insights = (items: string[]) => `<div class="insights"><h2>What stands out</h2>${items.length
  ? items.slice(0, 5).map((s, i) => `<div class="insight"><span class="insight-number">0${i + 1}</span><p>${text(s)}</p></div>`).join('')
  : para('No timed observations are available. Review scope and source availability before drawing conclusions.')}</div>`;
function stamp(epoch: number | null | undefined, zone: string) {
  if (epoch == null || !Number.isFinite(epoch)) return 'Not available';
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'medium', timeStyle: 'medium' }).format(epoch); }
  catch { return new Date(epoch).toISOString(); }
}
const dateString = (s: string, zone: string) => stamp(Date.parse(s), zone);
function color(value: string, fallback: string) { return /^#[\da-f]{6}$/i.test(value) ? value : fallback; }
function documentHtml(title: string, a: Appearance, body: string) {
  const dark = a.theme === 'dark';
  const p = {
    bg: color(a.palette.background, dark ? '#101820' : '#ffffff'),
    fg: color(a.palette.foreground, dark ? '#edf3f8' : '#142638'),
    card: color(a.palette.card, dark ? '#18232f' : '#f6f8fa'),
    muted: color(a.palette.mutedForeground, dark ? '#b7c6d5' : '#526476'),
    border: color(a.palette.border, dark ? '#354658' : '#ccd7e0'),
    accent: color(a.palette.primary, dark ? '#71c3fa' : '#15578c'),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${text(title)}</title><style>
@page { size: A4; margin: 40pt 38pt 42pt; background-color: ${p.bg};
  @top-left { content: "PROXYTOOLS / TRAFFIC INTELLIGENCE"; font-family: ProxyToolsReport; font-size: 7pt; color: ${p.muted}; }
  @bottom-left { content: "OBSERVED DATA / ${a.theme.toUpperCase()}"; font-family: ProxyToolsReport; font-size: 7pt; color: ${p.muted}; }
  @bottom-right { content: "PAGE " counter(page) " / " counter(pages); font-family: ProxyToolsReport; font-size: 7pt; color: ${p.muted}; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background-color: ${p.bg}; color: ${p.fg}; font-family: ProxyToolsReport, sans-serif; font-size: 9pt; line-height: 1.5; }
h1,h2,h3,strong,th,.metric { font-family: ProxyToolsReportSemibold, sans-serif; font-weight: 600; }
h1 { font-size: 34pt; line-height: 1.12; letter-spacing: -0.8pt; margin: 14pt 0 18pt; max-width: 460pt; }
h2 { font-size: 19pt; line-height: 1.25; margin: 5pt 0 13pt; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 12pt; line-height: 1.3; margin: 16pt 0 8pt; break-after: avoid; page-break-after: avoid; }
p { margin: 0 0 10pt; overflow-wrap: anywhere; white-space: pre-wrap; }
section { margin: 23pt 0 0; }
.eyebrow { color: ${p.accent}; font-family: ProxyToolsReportSemibold; font-size: 8pt; letter-spacing: 1.5pt; text-transform: uppercase; }
.cover { border-top: 4pt solid ${p.accent}; padding-top: 22pt; }
.dek { font-size: 13pt; line-height: 1.6; margin-bottom: 18pt; }
.meta { color: ${p.muted}; font-size: 8pt; border-top: 1pt solid ${p.border}; padding-top: 11pt; }
.kpis { display: flex; flex-wrap: wrap; gap: 9pt; margin: 19pt 0; }
.kpi { flex: 1 1 100pt; padding: 12pt; background-color: ${p.card}; border: 0.6pt solid ${p.border}; border-radius: 5pt; }
.metric { font-size: 20pt; line-height: 1.2; overflow-wrap: anywhere; }
.caption { font-size: 8pt; color: ${p.muted}; margin-top: 6pt; }
.note { font-size: 8pt; line-height: 1.5; color: ${p.muted}; margin: 9pt 0 12pt; }
.insights { border-left: 3pt solid ${p.accent}; padding: 14pt 16pt; margin: 22pt 0; background-color: ${p.card}; }
.insights h2 { font-size: 15pt; }
.insight { display: flex; gap: 10pt; margin-top: 10pt; break-inside: avoid; page-break-inside: avoid; }
.insight-number { color: ${p.accent}; font-family: ProxyToolsReportSemibold; font-size: 12pt; }
.insight p { flex: 1; margin: 0; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8pt; margin: 8pt 0 14pt; }
thead { display: table-header-group; }
th { text-align: left; color: ${p.muted}; background-color: ${p.card}; border-top: 1pt solid ${p.border}; }
th,td { padding: 7pt 6pt; vertical-align: top; border-bottom: 0.6pt solid ${p.border}; overflow-wrap: anywhere; white-space: pre-wrap; }
tr { break-inside: avoid; page-break-inside: avoid; }
.bar-row { margin: 0 0 12pt; break-inside: avoid; page-break-inside: avoid; }
.bar-label { display: flex; justify-content: space-between; gap: 12pt; margin-bottom: 4pt; font-size: 8pt; }
.bar-label span { overflow-wrap: anywhere; }
.bar-label strong { text-align: right; }
.track { height: 6pt; background-color: ${p.card}; border-bottom: 0.5pt solid ${p.border}; }
.fill { height: 6pt; background-color: ${p.accent}; }
.chart { border: 0.6pt solid ${p.border}; border-radius: 5pt; padding: 14pt; margin: 10pt 0 18pt; }
.chart h3 { margin-top: 0; }
.new-page { break-before: page; page-break-before: always; }
.period { margin-top: 22pt; }
.end { margin-top: 25pt; padding-top: 12pt; border-top: 2pt solid ${p.accent}; color: ${p.muted}; font-size: 8pt; }
</style></head><body>${body}<div class="end">ProxyTools / ${text(title)}<br>Generated natively with Ironpress. Observations describe available records; they are not a security verdict.</div></body></html>`;
}
function cover(title: string, subtitle: string, meta: string, values: [string, string][], caveat: string) {
  return `<header class="cover"><div class="eyebrow">ProxyTools / Intelligence Series</div><h1>${text(title)}</h1><p class="dek">${text(subtitle)}</p><p class="meta">${text(meta)}</p>${kpis(values)}${note(caveat)}</header>`;
}
/** Horizontal bars have explicit independent scales and numeric labels, even when all values are zero. */
function bars(title: string, rows: { label: string; value: number }[], metric: 'requests' | 'bytes', total = rows.length) {
  const shown = rows.slice(0, LIMIT);
  const max = Math.max(0, ...shown.map(e => Number.isFinite(e.value) ? e.value : 0));
  return `<div class="chart"><h3>${text(title)}</h3>${shown.length ? shown.map(e => {
    const width = max > 0 && Number.isFinite(e.value) ? Math.max(0, Math.min(100, e.value / max * 100)) : 0;
    return `<div class="bar-row"><div class="bar-label"><span>${text(e.label)}</span><strong>${text(metric === 'bytes' ? bytes(e.value) : number(e.value))}</strong></div><div class="track"><div class="fill" style="width:${escapeAttr(width.toFixed(3))}%"></div></div></div>`;
  }).join('') : note('No observations returned.')}${note(`Scale: 0 to ${metric === 'bytes' ? bytes(max) : number(max)} ${metric === 'requests' ? 'requests' : ''}. Each chart has its own scale.`)}${shown.length < total ? disclosure(shown.length, total) : ''}</div>`;
}
const FIELD_NAMES: Record<string, string> = {
  host: 'Destinations', client: 'Clients', category: 'Categories', action: 'Actions', status: 'HTTP status', application: 'Applications', user: 'Users',
  'cs-host': 'Destinations', 'c-ip': 'Clients', 'cs-username': 'Users', 'cs-method': 'HTTP methods', 'sc-status': 'HTTP status', 's-action': 'Actions',
  'cs-categories': 'Categories', 'x-bluecoat-application-name': 'Applications', 'x-issue': 'Reported issues', 'sc-filter-result': 'Filter results (informational)',
  'cs-threat-risk': 'Threat risk (reported)', 'x-bluecoat-access-security-policy-action': 'Security policy actions',
};
function entityName(name: string, field: string) {
  if (!name.trim() || name === '-') return 'Unspecified / unavailable';
  if (['category', 'cs-categories'].includes(field) && name.trim() === '0') return 'Unspecified category (source value 0)';
  return name;
}
function ranking(field: string, entries: Entry[], metric: 'requests' | 'bytes', total = entries.length) {
  const sorted = [...entries].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
  return bars(`${FIELD_NAMES[field] ?? field} / ${metric}`, sorted.map(e => ({ label: entityName(e.name, field), value: e[metric] })), metric, total);
}
function rankingTable(field: string, entries: Entry[], byteAvailable: boolean, total = entries.length) {
  const shown = entries.slice(0, 20);
  return `<h3>${text(FIELD_NAMES[field] ?? field)}</h3>${table(['Entity', 'Requests', 'Transferred'], shown.map(e => [entityName(e.name, field), number(e.requests), byteAvailable ? bytes(e.bytes) : 'Unavailable']))}${disclosure(shown.length, total)}`;
}
function timeline(rows: { epoch: number; requests: number; bytes: number }[], zone: string, byteAvailable: boolean) {
  const sorted = rows.filter(e => Number.isFinite(e.epoch)).sort((a, b) => a.epoch - b.epoch);
  if (!sorted.length) return note('No timestamped buckets are available.');
  const first = sorted[0].epoch, last = sorted[sorted.length - 1].epoch;
  const width = Math.max(60000, Math.ceil((last - first + 60000) / 12 / 60000) * 60000);
  const groups = new Map<number, { requests: number; bytes: number }>();
  for (const row of sorted) {
    const i = Math.floor((row.epoch - first) / width);
    const item = groups.get(i) ?? { requests: 0, bytes: 0 };
    item.requests += row.requests; item.bytes += row.bytes; groups.set(i, item);
  }
  const points = [...groups].sort(([a], [b]) => a - b).map(([i, v]) => ({ ...v, label: stamp(first + i * width, zone) }));
  return note(`Chronological aggregation of supplied timestamp buckets into ${number(width / 60000)}-minute windows. Bucket totals are assigned by their timestamp, without interpolation. Labels are window starts in ${zone}. Empty windows are omitted; gaps do not establish log coverage.`)
    + bars('Requests through time', points.map(e => ({ label: e.label, value: e.requests })), 'requests')
    + (byteAvailable ? bars('Transferred volume through time', points.map(e => ({ label: e.label, value: e.bytes })), 'bytes') : note('Transferred volume is unavailable or its field coverage is unknown.'));
}
function hasBytes(fields: { name: string; populated: number }[] | undefined) {
  return !!fields?.some(f => ['cs-bytes', 'sc-bytes'].includes(f.name) && f.populated > 0);
}
function fieldCoverage(fields: { name: string; status: string; populated: number; total: number }[]) {
  return table(['Source field', 'Availability', 'Populated / total', 'Share'], fields.slice(0, 64).map(f =>
    [f.name, f.status, `${number(f.populated)} / ${number(f.total)}`, percent(f.populated, f.total)]))
    + (fields.length > 64 ? disclosure(64, fields.length, 'fields') : '');
}
function delta(before: number, after: number, unit: 'requests' | 'bytes') {
  const value = after - before;
  const absolute = unit === 'bytes' ? bytes(Math.abs(value)) : number(Math.abs(value));
  return `${value < 0 ? '-' : '+'}${absolute}${before > 0 ? ` (${number(value / before * 100)}%)` : ' (percentage unavailable: zero baseline)'}`;
}
function periodSummary(periods: ComparisonPeriod[], byteAvailable: boolean, statusAvailable: boolean) {
  return table(['Period', 'Requests', 'Transferred', 'HTTP 4xx / 5xx', 'Denials / issues'], periods.map(p =>
    [p.label, number(p.requests), byteAvailable ? bytes(p.bytes) : 'Unavailable', statusAvailable ? `${number(p.http4xx)} / ${number(p.http5xx)}` : 'Unavailable', `${number(p.denied)} / ${number(p.issues)}`]));
}
export function comparisonHtmlReport(s: ComparisonSnapshot, appearance: Appearance): string {
  const all = s.result.periods;
  const periods = all.slice(0, PERIOD_LIMIT);
  const byteAvailable = s.result.sources.length > 0 && s.result.sources.every(source => hasBytes(source.fieldAvailability));
  const available = (field: string) => s.result.sources.length > 0 && s.result.sources.every(source => source.fieldAvailability?.some(f => f.name === field && f.populated > 0));
  const statusAvailable = available('sc-status');
  const clientsAvailable = available('c-ip');
  const hostsAvailable = available('cs-host');
  const most = [...all].sort((a, b) => b.requests - a.requests)[0];
  const errors = [...all].sort((a, b) => b.http5xx - a.http5xx)[0];
  const chronological = [...all].sort((a, b) => a.start - b.start);
  const changes = chronological.slice(1).map((p, i) => ({ before: chronological[i], after: p, amount: p.requests - chronological[i].requests }));
  const biggest = changes.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  const observations: string[] = [];
  if (most) observations.push(`${most.label} contains the most requests: ${number(most.requests)}. Its observed timestamp span covers ${number(comparisonCoverage(most))}% of its requested duration; this is not proof of complete logs.`);
  if (biggest) observations.push(`The largest adjacent-period request change is ${delta(biggest.before.requests, biggest.after.requests, 'requests')}, from ${biggest.before.label} to ${biggest.after.label}. Counts are not normalized for duration.`);
  if (errors && statusAvailable) observations.push(`${errors.label} has the largest observed HTTP 5xx count (${number(errors.http5xx)}). HTTP errors, policy denials and record issues are separate and may overlap.`);
  const leadingHost = most?.rankings.host?.slice().sort((a, b) => b.requests - a.requests)[0];
  if (leadingHost && most) observations.push(`${entityName(leadingHost.name, 'host')} leads the returned destination ranking in ${most.label}, with ${number(leadingHost.requests)} requests (${percent(leadingHost.requests, most.requests)} of that period).`);
  if (!byteAvailable) observations.push('Byte field coverage is missing, unknown or absent in one or more sources. This document withholds combined byte comparisons rather than treating unavailable data as zero.');
  if (observations.length < 5) observations.push(`The snapshot uses ${number(s.result.sources.length)} sources and excludes ${number(s.result.excluded)} records. Untimed source records and unassigned diagnostics are detailed in provenance; they cannot establish activity within a period.`);
  let body = cover('Comparative Traffic Intelligence', `${s.proxy} / ${s.profile}. A structured reading of ${number(all.length)} comparison periods, their concentration, changes and source confidence.`,
    `Snapshot: ${dateString(s.generatedAt, s.timeZone)} | Export: ${dateString(appearance.exportedAt, s.timeZone)} | ${s.timeZone} | ${appearance.theme} theme\nRequested: ${s.dateFrom} - ${s.dateTo}; ${s.from} - ${s.to} | Mode: ${s.mode} | ${s.commonInterval ? 'Common interval' : 'Original requested intervals'}`,
    [['Periods', number(all.length)], ['Sources', number(s.result.sources.length)], ['Excluded records', number(s.result.excluded)], ['Ranking metric', s.metric]],
    'Periods can overlap; their totals must not be added to estimate unique traffic. Field availability describes source coverage, not a security assessment.') + insights(observations);
  body += section('01 / Comparative overview', 'How the periods differ', para('Read request counts and transferred volume on separate scales. Unequal durations, gaps and overlapping windows can change totals without implying a behavioral change.')
    + bars('Requests by period / source order', periods.map(p => ({ label: p.label, value: p.requests })), 'requests', all.length)
    + (byteAvailable ? bars('Transferred volume by period / source order', periods.map(p => ({ label: p.label, value: p.bytes })), 'bytes', all.length) : note('Byte comparison withheld: incomplete or unknown source field availability.'))
    + periodSummary(periods, byteAvailable, statusAvailable) + (all.length > PERIOD_LIMIT ? disclosure(periods.length, all.length, 'periods; all original rows remain in the comparative CSV export') : ''), true);
  if (changes.length) body += section('02 / Changes', 'Adjacent periods in time', table(['Transition', 'Request delta', 'Transferred delta'], [...changes].sort((a, b) => a.after.start - b.after.start).slice(0, PERIOD_LIMIT).map(c =>
    [`${c.before.label} → ${c.after.label}`, delta(c.before.requests, c.after.requests, 'requests'), byteAvailable ? delta(c.before.bytes, c.after.bytes, 'bytes') : 'Unavailable']))
    + (changes.length > PERIOD_LIMIT ? disclosure(PERIOD_LIMIT, changes.length, 'adjacent-period transitions; complete deltas remain in CSV') : '')
    + note('Adjacent means sorted by requested start time. Overlapping periods are retained. A zero baseline has no percentage change.'));
  for (const [i, p] of periods.entries()) {
    body += section(`03 / Period ${i + 1}`, p.label,
      para(`${number(p.requests)} requests. Clients: ${clientsAvailable ? number(p.clients) : 'unavailable'}; destinations: ${hostsAvailable ? number(p.hosts) : 'unavailable'}. ${number(p.activeMinutes)} active minutes were observed.`)
      + table(['Requested start / end (exclusive)', 'Observed first / last', 'Observed span / request rate'], [[`${stamp(p.start, s.timeZone)}\n${stamp(p.end, s.timeZone)}`, `${stamp(p.requests > 0 ? p.first : null, s.timeZone)}\n${stamp(p.requests > 0 ? p.last : null, s.timeZone)}`, `${number(comparisonCoverage(p))}%\n${number(comparisonRate(p, 'requests'))} req/s`]])
      + table(['HTTP 4xx', 'HTTP 5xx', 'Policy denials', 'Record issues', 'Parse failures'], [[statusAvailable ? number(p.http4xx) : 'Unavailable', statusAvailable ? number(p.http5xx) : 'Unavailable', number(p.denied), number(p.issues), number(p.parseFailures)]])
      + timeline(p.timeline, s.timeZone, byteAvailable)
      + ranking('host', p.rankings.host ?? [], 'requests')
      + ranking('client', p.rankings.client ?? [], 'requests')
      + (byteAvailable ? ranking('host', p.rankings.host ?? [], 'bytes') : '')
      + note('Rankings contain the snapshot top-N returned by the query. Sorting them by bytes does not recover entities excluded by the original ranking metric.')
      + Object.entries(p.rankings).slice(0, 16).map(([field, entries]) => rankingTable(field, entries, byteAvailable)).join('')
      + table(['Requested constituent spans / start', 'End (exclusive)'], p.ranges.slice(0, 64).map(r => [stamp(r.start, s.timeZone), stamp(r.end, s.timeZone)]))
      + (p.ranges.length > 64 ? disclosure(64, p.ranges.length, 'requested spans; complete spans are in CSV') : ''), true);
  }
  body += section('04 / Entity continuity', 'Common, new and missing entities', note('Common and transition sets come directly from the comparison result. New or missing means present or absent in these returned sets, not proof that an entity appeared or disappeared from the network.'), true);
  for (const [field, entries] of Object.entries(s.result.common).slice(0, 16)) {
    body += `<h3>${text(FIELD_NAMES[field] ?? field)} / common</h3>` + table(['Entity', 'Period', 'Requests', 'Transferred'], entries.slice(0, 12).flatMap(e => e.values.slice(0, PERIOD_LIMIT).map(v =>
      [entityName(e.name, field), all.find(p => p.id === v.periodId)?.label ?? v.periodId, number(v.requests), byteAvailable ? bytes(v.bytes) : 'Unavailable']))) + disclosure(Math.min(entries.length, 12), entries.length, 'common entities');
    if (entries.some(e => e.values.length > PERIOD_LIMIT)) body += note(`Per-entity period values are limited to ${PERIOD_LIMIT}; complete values remain in CSV.`);
  }
  for (const [field, transitions] of Object.entries(s.result.changes ?? {}).slice(0, 16)) {
    for (const c of transitions.slice(0, PERIOD_LIMIT)) {
      const from = all.find(p => p.id === c.fromPeriod)?.label ?? c.fromPeriod;
      const to = all.find(p => p.id === c.toPeriod)?.label ?? c.toPeriod;
      body += `<h3>${text(FIELD_NAMES[field] ?? field)} / ${text(from)} → ${text(to)}</h3>` + table(['Set', 'Entity', 'Requests'], (['emerged', 'disappeared'] as const).flatMap(kind => c[kind].slice(0, 12).map(e => [kind === 'emerged' ? 'New in returned set' : 'Missing in returned set', entityName(e.name, field), number(e.requests)])))
        + note(`New: showing ${Math.min(c.emerged.length, 12)} of ${c.emerged.length}. Missing: showing ${Math.min(c.disappeared.length, 12)} of ${c.disappeared.length}.`);
    }
    if (transitions.length > PERIOD_LIMIT) body += disclosure(PERIOD_LIMIT, transitions.length, 'transitions; complete sets remain in CSV');
  }
  if (s.original) body += section('05 / Before alignment', 'Original interval results', para('These are the original results retained in the immutable snapshot before common-interval alignment. They are separate from the aligned results above.') + periodSummary(s.original.periods.slice(0, PERIOD_LIMIT), byteAvailable, statusAvailable)
    + disclosure(Math.min(s.original.periods.length, PERIOD_LIMIT), s.original.periods.length, 'original periods'), true);
  body += section('06 / Provenance & confidence', 'Read the evidence with its limits', para(COMPARISON_NOTE)
    + note('HTTP counts, unique client and destination counts are withheld when any source lacks populated corresponding fields. Counts from partially populated fields are observed values, not estimates of unrecorded events.')
    + para(`Snapshot ranking limit: ${number(s.topN)} per field; selected metric: ${s.metric}. This editorial document caps charts at 12 entities, ranking tables at 20, periods at 64 and sources at 100. The comparative CSV export retains full snapshot detail. Long labels are explicitly marked when shortened.`)
    + note('Transferred bytes sum available client/server byte fields and may be partial; populated fields do not establish complete byte coverage.')
    + note('Raw URLs, user names and destination labels are printed as escaped text, never loaded as resources. No credentials or live application DOM are included.'), true);
  for (const source of s.result.sources.slice(0, SOURCE_LIMIT)) {
    body += `<h3>${text(source.source)}</h3>` + table(['Capture / scope', 'Records / untimed', 'Diagnostics / unassigned'], [[`${source.id}\n${source.scope ? `${source.scope.profile} / ${source.scope.proxyIdentity}` : 'Unassigned scope'}`, `${number(source.records)} / ${number(source.untimedRecords)}`, `${number(source.diagnosticsTotal)} / ${number(source.unassignedDiagnostics)}`]])
      + para(`Observed source interval: ${stamp(source.first, s.timeZone)} - ${stamp(source.last, s.timeZone)}.`)
      + fieldCoverage(source.fieldAvailability ?? []);
  }
  if (s.result.sources.length > SOURCE_LIMIT) body += disclosure(SOURCE_LIMIT, s.result.sources.length, 'sources; complete provenance is in CSV');
  return documentHtml('Comparative Traffic Intelligence', appearance, body);
}

export function trafficHtmlReport(r: TrafficReport): string {
  const a = r.selection, summary = a.summary;
  const byteAvailable = hasBytes(r.availability);
  const available = (field: string) => r.availability.some(f => f.name === field && f.populated > 0);
  const topHost = [...(a.rankings['cs-host'] ?? [])].sort((a, b) => b.requests - a.requests)[0];
  const topClient = [...(a.rankings['c-ip'] ?? [])].sort((a, b) => b.requests - a.requests)[0];
  const observations: string[] = [
    `${number(summary.requests)} requests are in the ${r.selected ? 'selected scope' : 'complete capture'} (${percent(summary.requests, r.overall.summary.requests)} of capture requests). The capture contains ${number(r.overall.summary.requests)} requests overall.`,
  ];
  if (topHost) observations.push(`${entityName(topHost.name, 'cs-host')} leads returned destinations with ${number(topHost.requests)} requests (${percent(topHost.requests, summary.requests)} of scoped requests).`);
  if (topClient) observations.push(`${entityName(topClient.name, 'c-ip')} leads returned clients with ${number(topClient.requests)} requests (${percent(topClient.requests, summary.requests)} of scoped requests).`);
  const peak = r.peaks[0]?.window;
  if (peak) observations.push(`The strongest collected concentration window spans ${stamp(peak.start, r.timeZone)} - ${stamp(peak.end, r.timeZone)}, with ${number(peak.requests)} requests${byteAvailable ? ` and ${bytes(peak.bytes)}` : ''}. Its share of the selected ${r.metric} is ${number(peak.share)}%; this is a descriptive concentration heuristic.`);
  else observations.push('No concentration window met the existing capture heuristic. This does not establish the absence of traffic anomalies.');
  if (!byteAvailable) observations.push('Byte field coverage is unavailable. Transferred-volume charts and rates are withheld.');
  let body = cover('Traffic Analysis Report', `${r.proxy}. An evidence-led reading of request activity, leading entities and observed concentration windows.`,
    `${dateString(r.generatedAt, r.timeZone)} | ${r.timeZone} | ${r.theme} theme\nSource: ${r.source} | Capture: ${r.captureId}`,
    [['Scoped requests', number(summary.requests)], ['Transferred', byteAvailable ? bytes(summary.bytes) : 'Unavailable'], ['Clients', available('c-ip') ? number(summary.uniqueClients) : 'Unavailable'], ['Destinations', available('cs-host') ? number(summary.uniqueDestinations) : 'Unavailable']],
    'Timestamp spans describe observed events, not complete log coverage. Missing fields are unavailable; absent ranking entries do not establish a zero count.') + insights(observations);
  body += section('01 / Scope & context', 'The capture behind the story', table(['Scope', 'Requests', 'Transferred', 'Issues / denials'], [
    ['Full capture', number(r.overall.summary.requests), byteAvailable ? bytes(r.overall.summary.bytes) : 'Unavailable', `${number(r.overall.summary.issues)} / ${number(r.overall.summary.denied)}`],
    ['Selected scope', number(summary.requests), byteAvailable ? bytes(summary.bytes) : 'Unavailable', `${number(summary.issues)} / ${number(summary.denied)}`],
  ]) + table(['Requested start', 'Requested end', 'Observed first / last'], [[r.range.start === null ? 'Capture start (unbounded)' : stamp(r.range.start, r.timeZone), r.range.end === null ? 'Capture end (unbounded)' : stamp(r.range.end, r.timeZone), `${stamp(summary.first, r.timeZone)}\n${stamp(summary.last, r.timeZone)}`]])
    + table(['Active filter', 'Value'], Object.entries(r.filters).filter(([, value]) => value !== '').map(([field, value]) => [FIELD_NAMES[field] ?? field, value]))
    + note('An empty filter table means no active filters. Overall and selected values are distinct scopes, not additive totals. Volume rankings use the same selection with a byte-ranked query.'), true);
  body += section('02 / Activity', 'When traffic concentrates', timeline(a.timeline, r.timeZone, byteAvailable)
    + para(`Request rate: ${summary.first != null && summary.last != null && summary.last > summary.first ? `${number(summary.requestsPerSecond)} req/s` : 'unavailable (no observed duration)'}. ${byteAvailable && summary.first != null && summary.last != null && summary.last > summary.first ? `Transferred rate: ${bytes(summary.bytesPerSecond)}/s.` : ''} Rates use the observed interval; silent or missing minutes are not independent evidence of availability.`), true);
  body += section('03 / Leading entities', 'Who and what shapes the selection', ranking('cs-host', a.rankings['cs-host'] ?? [], 'requests', a.rankingCounts?.['cs-host'])
    + ranking('c-ip', a.rankings['c-ip'] ?? [], 'requests', a.rankingCounts?.['c-ip'])
    + (byteAvailable ? ranking('cs-host', r.volume.rankings['cs-host'] ?? [], 'bytes', r.volume.rankingCounts?.['cs-host']) : '')
    + note('Request and byte rankings are independently collected. Source category 0 is displayed as unspecified; no category meaning is invented.'), true);
  body += section('04 / Status & diagnostics', 'Outcomes in the available records', table(['Policy denials', 'Record issues', 'Capture diagnostics'], [[number(summary.denied), number(summary.issues), number(a.diagnosticsTotal)]])
    + rankingTable('sc-status', a.rankings['sc-status'] ?? [], byteAvailable, a.rankingCounts?.['sc-status'])
    + rankingTable('s-action', a.rankings['s-action'] ?? [], byteAvailable, a.rankingCounts?.['s-action'])
    + rankingTable('x-issue', a.rankings['x-issue'] ?? [], byteAvailable, a.rankingCounts?.['x-issue'])
    + note('Status rankings are a returned subset, so this report does not infer a complete HTTP error total from them. Denials, issues and HTTP errors may overlap. Parsing diagnostics can be untimed and cannot always be assigned to the selected period.')
    + table(['Diagnostic type', 'Fields expected / received', 'Source'], a.diagnostics.slice(0, 12).map(d => [d.errorType, `${number(d.expectedFields)} / ${number(d.receivedValues)}`, d.source]))
    + note(`Showing ${Math.min(a.diagnostics.length, 12)} diagnostic examples; aggregate diagnostic count: ${number(a.diagnosticsTotal)}. Raw log lines are omitted.`), true);
  body += section('05 / Concentration windows', 'Observed peaks in context', para(`${number(r.peaksFound)} windows met the capture concentration heuristic. ${number(r.peaks.length)} were collected for detailed analysis (maximum three). This heuristic compares minute buckets with the remaining observed interval, including silent gaps; it is not a security classification.`), true);
  for (const [i, p] of r.peaks.entries()) {
    body += `<h3>Window ${i + 1} / ${text(stamp(p.window.start, r.timeZone))}</h3>`
      + para(`End: ${stamp(p.window.end, r.timeZone)}. ${number(p.window.minutes)} minute(s), ${number(p.window.requests)} requests; ${byteAvailable ? bytes(p.window.bytes) : 'bytes unavailable'}. ${number(p.window.share)}% of scoped ${r.metric}; ${p.window.ratio === null ? 'no nonzero comparison baseline' : `${number(p.window.ratio)} times the other-minute average`}.`)
      + ranking('cs-host', p.analysis.rankings['cs-host'] ?? [], 'requests', p.analysis.rankingCounts?.['cs-host'])
      + ranking('c-ip', p.analysis.rankings['c-ip'] ?? [], 'requests', p.analysis.rankingCounts?.['c-ip'])
      + (byteAvailable ? ranking('cs-host', p.volume.rankings['cs-host'] ?? [], 'bytes', p.volume.rankingCounts?.['cs-host']) : '')
      + rankingTable('sc-status', p.analysis.rankings['sc-status'] ?? [], byteAvailable, p.analysis.rankingCounts?.['sc-status']);
  }
  body += section('06 / Reference appendix', 'Rankings, distributions & provenance', para('The appendix retains the collected ranking detail, capped at 20 entries per field. Collection currently requests top 10 per field; full raw records and expanded rankings remain accessible in Traffic Analysis. Labels longer than 600 characters are marked when shortened.'), true);
  for (const [field, entries] of Object.entries(a.rankings).slice(0, 24)) body += rankingTable(field, entries, byteAvailable, a.rankingCounts?.[field]);
  if (a.networkRankings?.length) {
    body += '<h3>Client networks / observed distribution</h3>' + table(['Network', 'Requests', 'Transferred', 'Clients'], a.networkRankings.slice(0, 20).map(n => [n.name, number(n.requests), byteAvailable ? bytes(n.bytes) : 'Unavailable', number(n.clients)])) + disclosure(Math.min(a.networkRankings.length, 20), a.networkCount ?? a.networkRankings.length, 'networks');
  }
  if (byteAvailable) {
    body += '<h3>Independently collected byte rankings</h3>';
    for (const field of ['cs-host', 'c-ip', 'cs-username']) body += rankingTable(field, r.volume.rankings[field] ?? [], true, r.volume.rankingCounts?.[field]);
  }
  body += section('07 / Data confidence', 'Availability and source notes', table(['Source', 'Capture', 'Received lines', 'Processed records'], [[r.source, r.captureId, number(r.receivedLines), number(r.processedRecords)]])
    + fieldCoverage(r.availability)
    + note('Field availability is measured across the capture, not recomputed for each filter or peak. Bytes sum available client/server byte fields and may be partial even when one field is populated. Missing timestamps, malformed records and unavailable fields limit interpretation. No missing field is converted into a factual zero.')
    + note('Time charts aggregate supplied timestamp buckets into up to 12 chronological windows; they are editorial summaries, not copies of the live UI. Full capture detail remains in the application and the legacy report option.'), true);
  return documentHtml('Traffic Analysis Report', { theme: r.theme, palette: r.palette, exportedAt: r.generatedAt }, body);
}
