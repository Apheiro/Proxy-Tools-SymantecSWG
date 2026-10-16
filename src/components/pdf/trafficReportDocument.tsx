/** biome-ignore-all lint/suspicious/noArrayIndexKey: immutable report snapshots use stable positions */
import {
  Document,
  Font,
  Page,
  pdf,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer';
import { createContext, type ReactNode, useContext } from 'react';
import {
  createTrafficTimeFormatter,
  formatBytes,
} from '@/lib/trafficAnalysis';
import type { CaptureRanking } from '@/lib/trafficCapture';
import type {
  ReportAnalysis,
  TrafficReport,
} from '@/lib/trafficReport';

let registeredBase = '';
export function registerTrafficReportFonts(base = '/fonts/report/') {
  if (registeredBase === base) return;
  Font.register({
    family: 'ProxyToolsReport',
    fonts: [
      { src: `${base}ProxyToolsReport-400.ttf`, fontWeight: 400 },
      { src: `${base}ProxyToolsReport-600.ttf`, fontWeight: 600 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registeredBase = base;
}
const number = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(
    value,
  );
const label = (value: string) =>
  value.length > 240 ? `${value.slice(0, 237)}...` : value;
const FIELDS = [
  ['Destinations', 'cs-host'],
  ['Clients', 'c-ip'],
  ['Users', 'cs-username'],
  ['HTTP methods', 'cs-method'],
  ['HTTP status', 'sc-status'],
  ['Actions', 's-action'],
  ['Categories', 'cs-categories'],
  ['Applications', 'x-bluecoat-application-name'],
  ['Reported issues', 'x-issue'],
  ['Filter results (informational)', 'sc-filter-result'],
  ['Threat risk (reported)', 'cs-threat-risk'],
  [
    'Security policy actions',
    'x-bluecoat-access-security-policy-action',
  ],
] as const;

function reportStyles(p: TrafficReport['palette']) {
  return StyleSheet.create({
    page: {
      fontFamily: 'ProxyToolsReport',
      fontSize: 9,
      lineHeight: 1.4,
      color: p.foreground,
      backgroundColor: p.background,
      paddingTop: 64,
      paddingBottom: 48,
      paddingHorizontal: 34,
    },
    header: {
      position: 'absolute',
      top: 22,
      height: 24,
      left: 34,
      right: 34,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: p.border,
      paddingBottom: 8,
      color: p.mutedForeground,
      fontSize: 8,
    },
    footer: {
      position: 'absolute',
      top: 808,
      height: 16,
      left: 34,
      right: 34,
      color: p.mutedForeground,
      fontSize: 7,
      lineHeight: 1.4,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    eyebrow: {
      fontSize: 8,
      color: p.mutedForeground,
      marginBottom: 5,
      letterSpacing: 1,
    },
    title: {
      fontSize: 24,
      lineHeight: 1.4,
      fontWeight: 600,
      marginBottom: 10,
    },
    heading: {
      fontSize: 15,
      lineHeight: 1.4,
      fontWeight: 600,
      marginBottom: 10,
    },
    muted: { color: p.mutedForeground, fontSize: 8 },
    panel: {
      backgroundColor: p.card,
      color: p.cardForeground,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 7,
      padding: 12,
      marginBottom: 12,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 14,
    },
    stat: {
      width: '48.9%',
      backgroundColor: p.card,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 6,
      padding: 8,
    },
    statValue: {
      fontSize: 18,
      lineHeight: 1.4,
      fontWeight: 600,
      color: p.cardForeground,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: 0.5,
      borderBottomColor: p.border,
      paddingVertical: 5,
      paddingHorizontal: 7,
    },
    tableHeader: { backgroundColor: p.muted, fontWeight: 600 },
    name: { width: '49%', paddingRight: 8, fontSize: 8 },
    requests: { width: '16%', textAlign: 'right', fontSize: 8 },
    bytes: { width: '22%', textAlign: 'right', fontSize: 8 },
    share: { width: '13%', textAlign: 'right', fontSize: 8 },
  });
}
const ReportContext = createContext<{
  report: TrafficReport;
  p: TrafficReport['palette'];
  styles: ReturnType<typeof reportStyles>;
  time: ReturnType<typeof createTrafficTimeFormatter>;
  available: (...fields: string[]) => boolean;
} | null>(null);
function useReport() {
  const context = useContext(ReportContext);
  if (!context) throw new Error('Missing PDF report context.');
  return context;
}
function Sheet({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const { report, styles } = useReport();

  return (
    <Page size='A4' style={styles.page} wrap>
      <View fixed style={styles.header}>
        <Text>PROXY TOOLS / TRAFFIC ANALYSIS</Text>
        <Text>{report.theme.toUpperCase()} REPORT</Text>
      </View>
      <View fixed style={styles.footer}>
        <Text style={{ flex: 1 }}>
          {report.timeZone} | {title}
        </Text>
      </View>
      <Text
        fixed
        style={{
          position: 'absolute',
          right: 34,
          top: 808,
          width: 60,
          fontSize: 7,
          lineHeight: 1.4,
          color: report.palette.mutedForeground,
          textAlign: 'right',
        }}
        render={({ pageNumber, totalPages }) =>
          `${pageNumber} / ${totalPages}`
        }
      />
      {children}
    </Page>
  );
}
function Summary({ analysis }: { analysis: ReportAnalysis }) {
  const { styles, available, time } = useReport();

  const s = analysis.summary;
  const hasTime = s.first !== null && s.last !== null;
  const stats = [
    ['Requests', number(s.requests)],
    [
      'Traffic volume',
      available('cs-bytes', 'sc-bytes')
        ? formatBytes(s.bytes)
        : 'Unavailable',
    ],
    ['Requests with issues', number(s.issues)],
    ['Denied transactions', number(s.denied)],
    [
      'Unique clients',
      available('c-ip') ? number(s.uniqueClients) : 'Unavailable',
    ],
    [
      'Unique users',
      available('cs-username')
        ? number(s.uniqueUsers)
        : 'Unavailable',
    ],
    [
      'Unique destinations',
      available('cs-host')
        ? number(s.uniqueDestinations)
        : 'Unavailable',
    ],
    [
      'Average requests / second',
      hasTime ? number(s.requestsPerSecond) : 'Unavailable',
    ],
  ];
  return (
    <>
      <View style={styles.grid}>
        {stats.map(([title, value]) => (
          <View key={title} style={styles.stat} wrap={false}>
            <Text style={styles.muted}>{title}</Text>
            <Text style={styles.statValue}>{value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.muted}>
        First: {s.first === null ? 'Unavailable' : time(s.first)} |
        Last: {s.last === null ? 'Unavailable' : time(s.last)}
      </Text>
      <Text style={[styles.muted, { marginBottom: 12 }]}>
        Average throughput:{' '}
        {hasTime && available('cs-bytes', 'sc-bytes')
          ? `${formatBytes(s.bytesPerSecond)}/s`
          : 'Unavailable'}
      </Text>
    </>
  );
}
function Timeline({ analysis }: { analysis: ReportAnalysis }) {
  const { styles, report, time, p } = useReport();

  const bins = analysis.timeline;
  if (!bins.length)
    return (
      <Text style={styles.muted}>
        No valid timestamps are available for a timeline.
      </Text>
    );
  const first = bins[0].epoch,
    last = bins.at(-1)!.epoch;
  const columns = Math.min(
    100,
    Math.max(1, Math.floor((last - first) / 60000) + 1),
  );
  const values = Array.from({ length: columns }, () => 0);
  for (const b of bins) {
    const index = Math.min(
      columns - 1,
      Math.floor(
        ((b.epoch - first) / Math.max(1, last - first + 60000)) *
          columns,
      ),
    );
    values[index] += b[report.metric];
  }
  const maximum = Math.max(1, ...values);
  return (
    <View style={styles.panel} wrap={false}>
      <Text style={{ fontWeight: 600, marginBottom: 5 }}>
        {report.metric === 'bytes' ? 'Traffic volume' : 'Requests'}{' '}
        over time
      </Text>
      <Text style={[styles.muted, { marginBottom: 8 }]}>
        Maximum displayed interval:{' '}
        {report.metric === 'bytes'
          ? formatBytes(maximum)
          : number(maximum)}
        . At most 100 equal-duration display intervals; totals are
        preserved.
      </Text>
      <Svg width={455} height={112} viewBox='0 0 455 112'>
        {values.map((v, i) => (
          <Rect
            key={i}
            x={(i * 455) / columns}
            y={110 - (v / maximum) * 105}
            width={Math.max(0.5, 455 / columns - 1)}
            height={(v / maximum) * 105}
            fill={p.primary}
          />
        ))}
      </Svg>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 6,
        }}
      >
        <Text style={styles.muted}>{time(first)}</Text>
        <Text style={styles.muted}>{time(last + 59999)}</Text>
      </View>
    </View>
  );
}
function Ranking({
  title,
  entries,
  byBytes = false,
}: {
  title: string;
  entries: CaptureRanking[];
  byBytes?: boolean;
}) {
  const { styles, available } = useReport();

  return (
    <View style={{ marginBottom: 16 }} wrap={false}>
      <Text
        style={{
          fontWeight: 600,
          fontSize: 11,
          lineHeight: 1.4,
          marginBottom: 5,
        }}
      >
        {title}
      </Text>
      <Text style={[styles.muted, { marginBottom: 5 }]}>
        Top {entries.length} by {byBytes ? 'volume' : 'requests'} |
        share is relative to this section's{' '}
        {byBytes ? 'bytes' : 'requests'}.
      </Text>
      <View style={[styles.row, styles.tableHeader]}>
        <Text style={styles.name}>Name</Text>
        <Text style={styles.requests}>Requests</Text>
        <Text style={styles.bytes}>Bytes</Text>
        <Text style={styles.share}>Share</Text>
      </View>
      {entries.length ? (
        entries.map((entry, i) => (
          <View
            key={`${i}-${entry.name}`}
            style={styles.row}
            wrap={false}
          >
            <Text style={styles.name}>{label(entry.name)}</Text>
            <Text style={styles.requests}>
              {number(entry.requests)}
            </Text>
            <Text style={styles.bytes}>
              {available('cs-bytes', 'sc-bytes')
                ? formatBytes(entry.bytes)
                : 'N/A'}
            </Text>
            <Text style={styles.share}>
              {number(entry.percentage)}%
            </Text>
          </View>
        ))
      ) : (
        <Text style={[styles.muted, { padding: 8 }]}>
          No populated values for this field in this scope.
        </Text>
      )}
    </View>
  );
}

export function TrafficReportDocument({
  report,
}: {
  report: TrafficReport;
}) {
  const p = report.palette;
  const time = createTrafficTimeFormatter(report.timeZone);
  const available = (...fields: string[]) =>
    report.availability.some(
      (f) => fields.includes(f.name) && f.populated > 0,
    );
  const styles = reportStyles(p);

  const filters = Object.entries(report.filters).filter(([, v]) =>
    v.trim(),
  );
  const timedRequests = report.selection.timeline.reduce(
    (n, b) => n + b.requests,
    0,
  );
  return (
    <ReportContext.Provider
      value={{ report, p, styles, time, available }}
    >
      <Document
        title='Traffic Analysis Report'
        author='Proxy Tools'
        subject='Capture analytics and concentrated traffic peaks'
        language='en'
      >
        <Sheet title='Capture overview'>
          <Text style={styles.eyebrow}>
            PROXY DIAGNOSTICS / CAPTURE REPORT
          </Text>
          <Text style={styles.title}>Traffic Analysis</Text>
          <View style={styles.panel}>
            <Text
              style={{
                fontWeight: 600,
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              {label(report.proxy || 'Imported capture')}
            </Text>
            <Text>Source: {label(report.source)}</Text>
            <Text style={styles.muted}>
              Generated: {time(report.generatedAt)} | Time zone:{' '}
              {report.timeZone}
            </Text>
            <Text style={styles.muted}>
              Capture: {report.captureId} | Theme captured at export:{' '}
              {report.theme}
            </Text>
          </View>
          <Text style={styles.heading}>Entire capture</Text>
          <Summary analysis={report.overall} />
          <Timeline analysis={report.overall} />
          <Text style={styles.muted}>
            Aggregates cover all indexed records, independent of the
            visible record page or active UI tab. Raw log records are
            not dumped into this report. Rankings show the top 10;
            labels longer than 240 characters are abbreviated.
          </Text>
        </Sheet>
        <Sheet title='Scope and traffic profile'>
          <Text style={styles.heading}>
            {report.selected
              ? 'Selected range and filters'
              : 'Traffic profile and detection scope'}
          </Text>
          <View style={styles.panel}>
            <Text>
              Scope:{' '}
              {report.selected
                ? 'Selected range / filters'
                : 'Entire capture'}
            </Text>
            <Text>
              Range:{' '}
              {report.range.start === null
                ? 'Capture start'
                : time(report.range.start)}{' '}
              -{' '}
              {report.range.end === null
                ? 'Capture end'
                : time(report.range.end)}
            </Text>
            {filters.length ? (
              filters.map(([key, value]) => (
                <Text key={key}>
                  {key}: {label(value)}
                </Text>
              ))
            ) : (
              <Text>No field filters.</Text>
            )}
            <Text style={styles.muted}>
              Peak metric: {report.metric}. The Errors & Security tab
              does not restrict this report to a visible record page.
            </Text>
          </View>
          {report.selected && <Summary analysis={report.selection} />}
          <Timeline analysis={report.selection} />
          <View style={styles.panel}>
            <Text style={{ fontWeight: 600 }}>
              Concentrated traffic peaks
            </Text>
            <Text>
              {report.peaksFound} detected; {report.peaks.length}{' '}
              largest windows detailed.
            </Text>
            <Text style={styles.muted}>
              Minute buckets qualify when their volume is at least 3
              times the average of the other observed minutes (silent
              gaps included), contributes at least 5% of the timed
              total, and contains at least{' '}
              {report.metric === 'requests' ? '3 requests' : '1 KiB'}.
              Adjacent qualifying minutes are merged. Windows are
              ranked by {report.metric}; detailed queries use the
              exact interval and current filters.
            </Text>
          </View>
          {!report.peaks.length && (
            <Text style={styles.muted}>
              No interval satisfies this heuristic. A single observed
              minute cannot provide a comparative baseline. This does
              not imply the absence of operational problems.
            </Text>
          )}
          <Text style={styles.muted}>
            {number(
              Math.max(
                0,
                report.selection.summary.requests - timedRequests,
              ),
            )}{' '}
            selected requests have no usable timeline timestamp and
            are not part of peak detection. Concentration alone is not
            evidence of an attack or its cause.
          </Text>
        </Sheet>
        {[0, 2, 4, 6, 8, 10].map((offset) => (
          <Sheet key={offset} title='Selected scope rankings'>
            <Text style={styles.heading}>
              Traffic breakdown /{' '}
              {report.selected ? 'selected scope' : 'entire capture'}
            </Text>
            {FIELDS.slice(offset, offset + 2).map(
              ([title, field]) => (
                <Ranking
                  key={field}
                  title={title}
                  entries={report.selection.rankings[field] || []}
                />
              ),
            )}
          </Sheet>
        ))}
        <Sheet title='Volume contributors'>
          <Text style={styles.heading}>
            Top volume contributors / selected scope
          </Text>
          {[
            ['Destinations', 'cs-host'],
            ['Clients', 'c-ip'],
            ['Users', 'cs-username'],
          ].map(([title, field]) => (
            <Ranking
              key={field}
              title={title}
              entries={report.volume.rankings[field] || []}
              byBytes
            />
          ))}
        </Sheet>
        {report.peaks.map((peak, i) => (
          <Sheet key={peak.window.start} title={`Peak ${i + 1}`}>
            <Text style={styles.eyebrow}>
              CONCENTRATED TRAFFIC / {report.metric.toUpperCase()}
            </Text>
            <Text style={styles.heading}>
              Peak {i + 1}: {time(peak.window.start)} -{' '}
              {time(peak.window.end)}
            </Text>
            <View style={styles.panel}>
              <Text>
                {number(peak.window.share)}% of timed {report.metric}{' '}
                in the detection scope | {peak.window.minutes} minute
                bucket(s)
              </Text>
              <Text>
                {peak.window.ratio === null
                  ? 'All timed volume is concentrated here; the outside baseline is zero.'
                  : `${number(peak.window.ratio)}x the average per minute outside this window.`}
              </Text>
              <Text style={styles.muted}>
                Contributor shares below are relative to this peak,
                not the entire capture. They identify concentration,
                not causation.
              </Text>
            </View>
            <Summary analysis={peak.analysis} />
            {FIELDS.slice(0, 6).map(([title, field]) => (
              <Ranking
                key={field}
                title={`Peak / ${title}`}
                entries={peak.analysis.rankings[field] || []}
              />
            ))}
            <Ranking
              title='Peak / reported issues'
              entries={peak.analysis.rankings['x-issue'] || []}
            />
            <Ranking
              title='Peak / destinations by volume'
              entries={peak.volume.rankings['cs-host'] || []}
              byBytes
            />
          </Sheet>
        ))}
        <Sheet title='Data quality and provenance'>
          <Text style={styles.heading}>
            Data quality and provenance
          </Text>
          <View style={styles.panel}>
            <Text>
              Received lines: {number(report.receivedLines)} |
              Processed records: {number(report.processedRecords)}
            </Text>
            <Text>
              Capture diagnostics:{' '}
              {number(report.overall.diagnosticsTotal)}
            </Text>
            <Text style={styles.muted}>
              Availability and diagnostics describe the complete
              capture, not just the selected range. Missing values are
              not assumed to be zero. Filter results are informational
              and are not treated as an error count.
            </Text>
          </View>
          <Text style={{ fontWeight: 600, marginBottom: 8 }}>
            Field availability
          </Text>
          {report.availability.map((field) => (
            <View key={field.name} style={styles.row} wrap={false}>
              <Text style={{ width: '46%', fontSize: 8 }}>
                {label(field.name)}
              </Text>
              <Text style={{ width: '24%', fontSize: 8 }}>
                {field.status}
              </Text>
              <Text
                style={{
                  width: '30%',
                  fontSize: 8,
                  textAlign: 'right',
                }}
              >
                {number(field.populated)} / {number(field.total)}
              </Text>
            </View>
          ))}
          <Text
            style={{
              fontWeight: 600,
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Diagnostic sample (
            {Math.min(10, report.overall.diagnostics.length)} of{' '}
            {number(report.overall.diagnosticsTotal)})
          </Text>
          {report.overall.diagnostics.slice(0, 10).map((d, i) => (
            <View key={`${i}`} style={styles.panel} wrap={false}>
              <Text>
                {label(d.source)} / {d.errorType}
              </Text>
              <Text style={styles.muted}>
                Expected fields: {d.expectedFields}; received:{' '}
                {d.receivedValues}. Raw lines omitted.
              </Text>
            </View>
          ))}
          {!report.overall.diagnosticsTotal && (
            <Text style={styles.muted}>
              No ingestion diagnostics were reported.
            </Text>
          )}
        </Sheet>
      </Document>
    </ReportContext.Provider>
  );
}
export async function trafficReportBlob(report: TrafficReport) {
  registerTrafficReportFonts();
  return pdf(<TrafficReportDocument report={report} />).toBlob();
}
