import {
  Circle,
  Document,
  G,
  Line,
  Path,
  Page,
  pdf,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer';
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { formatBytes } from '@/lib/trafficAnalysis';
import {
  COMPARISON_NOTE,
  comparisonCoverage,
  comparisonNumber as number,
  comparisonRate,
  type ComparisonEntry,
  type ComparisonPeriod,
  type ComparisonSnapshot,
} from '@/lib/trafficComparison';
import type {
  ReportMetric,
  ReportPalette,
} from '@/lib/trafficReport';
import {
  activityAxis,
  activityPoints,
} from '@/lib/trafficComparisonPresentation';
import { registerTrafficReportFonts } from './trafficReportDocument';

export type ComparisonPdfAppearance = {
  theme: 'light' | 'dark';
  palette: ReportPalette;
  exportedAt: string;
};
function reportStyles(p: ReportPalette) {
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
      letterSpacing: 1,
      color: p.mutedForeground,
      marginBottom: 5,
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
    subheading: {
      fontSize: 11,
      lineHeight: 1.4,
      fontWeight: 600,
      marginBottom: 6,
    },
    note: { fontSize: 8, color: p.mutedForeground, marginBottom: 8 },
    panel: {
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 7,
      backgroundColor: p.card,
      color: p.cardForeground,
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
      width: '32.2%',
      padding: 8,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      color: p.cardForeground,
      borderRadius: 6,
    },
    value: {
      fontSize: 18,
      lineHeight: 1.4,
      fontWeight: 600,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: 0.5,
      borderBottomColor: p.border,
      paddingVertical: 5,
      paddingHorizontal: 7,
    },
    tableHead: { backgroundColor: p.muted, fontWeight: 600 },
    name: { width: '55%', paddingRight: 7, fontSize: 8 },
    requests: { width: '21%', textAlign: 'right', fontSize: 8 },
    bytes: { width: '24%', textAlign: 'right', fontSize: 8 },
  });
}
const PdfContext = createContext<
  | (ComparisonPdfAppearance & {
      styles: ReturnType<typeof reportStyles>;
      activity: (ReturnType<typeof pdfActivity> & {
        period: ComparisonPeriod;
      })[];
      activityMaximum: number;
    })
  | null
>(null);
function usePdf() {
  const context = useContext(PdfContext);
  if (!context) throw new Error('Missing comparative PDF theme.');
  return context;
}
const label = (s: string) =>
  s.length > 240 ? `${s.slice(0, 237)}...` : s;
const fieldLabels: Record<string, string> = {
  host: 'Destinations',
  client: 'Clients',
  category: 'Categories',
  action: 'Actions',
  status: 'HTTP status',
  application: 'Applications',
  user: 'Users',
};
function time(snapshot: ComparisonSnapshot, epoch: number) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: snapshot.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  }).format(epoch);
}
function Sheet({
  snapshot,
  title,
  children,
}: {
  snapshot: ComparisonSnapshot;
  title: string;
  children: ReactNode;
}) {
  const { styles, theme, exportedAt } = usePdf();
  return (
    <Page size='A4' style={styles.page} wrap>
      <View fixed style={styles.header}>
        <Text>PROXY TOOLS / COMPARATIVE REPORTS</Text>
        <Text>{theme.toUpperCase()} REPORT</Text>
      </View>
      <View fixed style={styles.footer}>
        <Text style={{ flex: 1, paddingRight: 60 }}>
          {snapshot.timeZone} | {title} | Export {exportedAt}
        </Text>
        <Text
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: 50,
            textAlign: 'right',
          }}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </View>
      {children}
    </Page>
  );
}
function change(current: number, prior: number) {
  if (!Number.isFinite(current) || !Number.isFinite(prior))
    return 'Unavailable';
  const absolute = current - prior;
  return `${absolute >= 0 ? '+' : ''}${number(absolute)} (${prior > 0 ? `${absolute >= 0 ? '+' : ''}${number((absolute / prior) * 100)}%` : 'no nonzero baseline'})`;
}
function PeriodSummary({
  p,
  snapshot,
  previous,
}: {
  p: ComparisonPeriod;
  snapshot: ComparisonSnapshot;
  previous?: ComparisonPeriod;
}) {
  const { styles } = usePdf();
  const rate = comparisonRate(p, 'requests');
  const byteRate = comparisonRate(p, 'bytes');
  return (
    <View style={styles.panel} wrap={false}>
      <Text style={styles.subheading}>{p.label}</Text>
      <Text>
        Requests: {number(p.requests)} | Bytes: {formatBytes(p.bytes)}{' '}
        ({number(p.bytes)} B)
      </Text>
      <Text style={styles.note}>
        Requested:{' '}
        {p.ranges
          .map(
            (r) =>
              `${time(snapshot, r.start)} - ${time(snapshot, r.end)}`,
          )
          .join('; ')}{' '}
        (exclusive ends)
      </Text>
      {p.ranges.length > 1 &&
        p.ranges.map((r) => (
          <Text key={r.start} style={styles.note}>
            UTC segment: {new Date(r.start).toISOString()} -{' '}
            {new Date(r.end).toISOString()}
          </Text>
        ))}
      <Text style={styles.note}>
        Observed: {time(snapshot, p.first)} - {time(snapshot, p.last)}{' '}
        | {number(comparisonCoverage(p))}% endpoint span estimate
      </Text>
      <Text>
        Observed rate:{' '}
        {rate === null ? 'N/A' : `${number(rate)} requests/s`} |{' '}
        {byteRate === null ? 'N/A' : `${formatBytes(byteRate)}/s`} |
        Active minutes: {number(p.activeMinutes)}
      </Text>
      {p.maxEventGapMs !== undefined && p.maxEventGapMs >= 300000 && (
        <Text style={styles.note}>
          Possible discontinuity: the largest separation between
          occupied minute buckets is {number(p.maxEventGapMs / 60000)}{' '}
          minutes. Silence and unavailable logs cannot be
          distinguished.
        </Text>
      )}
      <Text>
        HTTP 4xx: {number(p.http4xx)} | HTTP 5xx: {number(p.http5xx)}{' '}
        | Policy denials: {number(p.denied)} | Record issues:{' '}
        {number(p.issues)}
      </Text>
      {p.parseFailures !== undefined && (
        <Text>
          Indexed parse failures: {number(p.parseFailures)} (included
          in record issues; source diagnostics are separate).
        </Text>
      )}
      <Text>
        Unique clients: {number(p.clients)} | Unique destinations:{' '}
        {number(p.hosts)}
      </Text>
      {previous && (
        <Text style={styles.note}>
          Change from preceding period: requests{' '}
          {change(p.requests, previous.requests)}; bytes{' '}
          {change(p.bytes, previous.bytes)}. Raw totals may have
          different observed durations.
        </Text>
      )}
      <Text style={styles.note}>
        Observed endpoints do not certify full logs. Activity within
        the span may be discontinuous; an eventless minute cannot
        establish missing logs.
      </Text>
    </View>
  );
}
function Ranking({
  title,
  entries,
}: {
  title: string;
  entries: ComparisonEntry[];
}) {
  const { styles } = usePdf();
  return (
    <View style={{ marginBottom: 13 }}>
      <Text style={styles.subheading} minPresenceAhead={45}>
        {title}
      </Text>
      <View style={[styles.row, styles.tableHead]} wrap={false}>
        <Text style={styles.name}>Entity</Text>
        <Text style={styles.requests}>Requests</Text>
        <Text style={styles.bytes}>Bytes</Text>
      </View>
      {entries.map((e) => (
        <View key={e.name} style={styles.row} wrap={false}>
          <Text style={styles.name}>{label(e.name)}</Text>
          <Text style={styles.requests}>{number(e.requests)}</Text>
          <Text style={styles.bytes}>{number(e.bytes)} B</Text>
        </View>
      ))}
      {!entries.length && (
        <Text style={styles.note}>
          No populated values available.
        </Text>
      )}
    </View>
  );
}
const WIDTH = 527;
const chunks = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
const metricText = (value: number, metric: ReportMetric) =>
  metric === 'bytes' ? formatBytes(value) : number(value);
function seriesStyle(index: number, palette: ReportPalette) {
  return {
    color: [
      palette.primary,
      palette.destructive,
      palette.mutedForeground,
    ][index % 3],
    dash: index % 6 < 3 ? undefined : '5 3',
  };
}
function overlappingPeriods(periods: ComparisonPeriod[]) {
  const spans = periods
    .flatMap((p) =>
      p.ranges.length ? p.ranges : [{ start: p.start, end: p.end }],
    )
    .sort((a, b) => a.start - b.start);
  let end = -Infinity;
  for (const span of spans) {
    if (span.start < end) return true;
    end = Math.max(end, span.end);
  }
  return false;
}
function ExecutiveOverview({
  snapshot,
}: {
  snapshot: ComparisonSnapshot;
}) {
  const { styles, palette, exportedAt } = usePdf();
  const periods = snapshot.result.periods;
  const ordered = [...periods].sort((a, b) => a.start - b.start);
  const overlap = overlappingPeriods(periods);
  const sum = (
    field:
      | 'requests'
      | 'bytes'
      | 'http4xx'
      | 'http5xx'
      | 'denied'
      | 'issues',
  ) => periods.reduce((n, p) => n + p[field], 0);
  const first = ordered[0],
    last = ordered.at(-1);
  const partial = periods.filter(
    (p) => comparisonCoverage(p) < 99.9,
  ).length;
  const stats = [
    ['Observed periods', number(periods.length)],
    [
      'Observed requests',
      overlap ? 'Not consolidated' : number(sum('requests')),
    ],
    [
      'Observed bytes',
      overlap ? 'Not consolidated' : formatBytes(sum('bytes')),
    ],
    [
      'HTTP 4xx / 5xx requests',
      overlap
        ? 'See period details'
        : `${number(sum('http4xx'))} / ${number(sum('http5xx'))}`,
    ],
    [
      'Policy denials',
      overlap ? 'See period details' : number(sum('denied')),
    ],
    [
      'Requests with issues',
      overlap ? 'See period details' : number(sum('issues')),
    ],
  ];
  return (
    <Sheet snapshot={snapshot} title='Executive overview'>
      <Text style={styles.eyebrow}>
        PROXY DIAGNOSTICS / HISTORICAL TRAFFIC
      </Text>
      <Text style={styles.title}>Comparative Reports</Text>
      <View style={styles.panel}>
        <Text style={styles.subheading}>
          Context: {label(snapshot.proxy || 'Selected context')} /{' '}
          {snapshot.profile}
        </Text>
        <Text>
          {snapshot.timeZone} |{' '}
          {snapshot.mode === 'hourly'
            ? `${snapshot.from}–${snapshot.to}, recurring local time`
            : snapshot.mode === 'weekly'
              ? 'Calendar weeks, Monday–Sunday'
              : 'Full local days'}
        </Text>
        <Text style={styles.note}>
          Date bounds: {snapshot.dateFrom || 'all observed dates'} –{' '}
          {snapshot.dateTo || 'all observed dates'}. Optional dates
          clip calendar weeks.
        </Text>
        <Text style={styles.note}>
          Results calculated:{' '}
          {time(snapshot, Date.parse(snapshot.generatedAt))} |{' '}
          {snapshot.generatedAt}
        </Text>
        <Text style={styles.note}>
          Exported: {time(snapshot, Date.parse(exportedAt))} |{' '}
          {exportedAt}
        </Text>
        <Text style={styles.note}>
          Top {snapshot.topN} by {snapshot.metric}. Common clock
          interval:{' '}
          {snapshot.commonInterval
            ? 'enabled; original totals retained in appendix'
            : 'disabled'}
          .
        </Text>
        {snapshot.result.sources.some(source => !source.scope) && (
          <Text style={styles.note}>
            Includes explicitly selected Unassigned captures. The current
            proxy/profile context does not establish their ownership.
          </Text>
        )}
      </View>
      <View style={styles.grid}>
        {stats.map(([title, value]) => (
          <View key={title} style={styles.stat} wrap={false}>
            <Text style={styles.note}>{title}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={styles.panel} wrap={false}>
        <Text style={styles.subheading}>
          First → last observed period
        </Text>
        {first && last && periods.length > 1 ? (
          <>
            <Text style={styles.note}>
              {first.label} → {last.label}; calendar order, not the
              first and last event in one capture.
            </Text>
            <Text>
              Requests: {change(last.requests, first.requests)}
            </Text>
            <Text>
              Bytes: {last.bytes - first.bytes < 0 ? '−' : '+'}
              {formatBytes(Math.abs(last.bytes - first.bytes))} (
              {first.bytes > 0
                ? `${number((last.bytes / first.bytes - 1) * 100)}%`
                : 'no nonzero baseline'}
              )
            </Text>
            <Text style={styles.note}>
              Traffic increase/decrease is descriptive, not a quality
              judgment. Totals can cover different observed durations;
              normalized rates and exact spans follow.
            </Text>
          </>
        ) : (
          <Text style={styles.note}>
            At least two periods with events are required for a delta.
          </Text>
        )}
      </View>
      <Text style={styles.subheading}>
        Observed span, not certified log coverage
      </Text>
      <Svg width={WIDTH} height={34} viewBox={`0 0 ${WIDTH} 34`}>
        <Rect
          x={0}
          y={2}
          width={WIDTH}
          height={10}
          fill={palette.muted}
        />
        {periods.length > 0 && (
          <Rect
            x={0}
            y={2}
            width={(WIDTH * partial) / periods.length}
            height={10}
            fill={palette.primary}
          />
        )}
        <Text
          x={0}
          y={28}
          style={{ fontSize: 8 }}
          fill={palette.mutedForeground}
        >
          {partial} periods below 99.9% endpoint-span estimate /{' '}
          {periods.length} observed periods
        </Text>
      </Svg>
      <Text style={styles.note}>
        {snapshot.result.excluded} candidates excluded without events
        in the requested window. Missing dates are never inserted as
        zero. HTTP errors, denials and issues can overlap; do not add
        these diagnostic categories.
      </Text>
      <Text style={styles.note}>
        {overlap
          ? 'Requested UTC spans overlap: aggregate requests/bytes are intentionally not consolidated. Per-period totals remain real, but the same event may appear in multiple periods.'
          : 'Request and byte sums cover disjoint requested UTC spans. Unique clients/destinations are period-level counts and are never summed.'}
      </Text>
      <Text style={styles.note}>
        Values use available indexed fields; missing
        bytes/status/policy fields do not establish zero traffic or
        zero failures. Availability and ingestion diagnostics are
        detailed by source.
      </Text>
    </Sheet>
  );
}
function PeriodVolumeChart({
  snapshot,
  periods,
  metric,
}: {
  snapshot: ComparisonSnapshot;
  periods: ComparisonPeriod[];
  metric: ReportMetric;
}) {
  const { palette, styles } = usePdf();
  const maximum = snapshot.result.periods.reduce(
    (n, p) => Math.max(n, p[metric]),
    1,
  );
  const left = 142,
    plot = 270,
    row = 22,
    height = periods.length * row + 30;
  return (
    <View style={styles.panel} wrap={false}>
      <Text style={styles.subheading}>
        {metric === 'requests' ? 'Requests' : 'Bytes'} / independent
        scale
      </Text>
      <Svg
        width={WIDTH - 24}
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
      >
        {[0, 0.5, 1].map((t) => (
          <Line
            key={t}
            x1={left + plot * t}
            x2={left + plot * t}
            y1={0}
            y2={height - 24}
            stroke={palette.border}
            strokeWidth={0.5}
          />
        ))}
        {periods.map((p, index) => {
          const globalIndex = snapshot.result.periods.findIndex(
            (v) => v.id === p.id,
          );
          const color = seriesStyle(globalIndex, palette).color;
          return (
            <G key={p.id}>
              <Text
                x={0}
                y={index * row + 12}
                style={{ fontSize: 7.5 }}
                fill={palette.cardForeground}
              >
                {p.label}
              </Text>
              <Rect
                x={left}
                y={index * row + 3}
                width={plot}
                height={12}
                fill={palette.muted}
              />
              <Rect
                x={left}
                y={index * row + 3}
                width={(plot * p[metric]) / maximum}
                height={12}
                fill={color}
              />
              <Text
                x={WIDTH - 2}
                y={index * row + 12}
                textAnchor='end'
                style={{ fontSize: 7.5 }}
                fill={palette.cardForeground}
              >
                {metricText(p[metric], metric)}
              </Text>
            </G>
          );
        })}
        <Text
          x={left}
          y={height - 5}
          style={{ fontSize: 7 }}
          fill={palette.mutedForeground}
        >
          0
        </Text>
        <Text
          x={left + plot}
          y={height - 5}
          textAnchor='end'
          style={{ fontSize: 7 }}
          fill={palette.mutedForeground}
        >
          {metricText(maximum, metric)}
        </Text>
      </Svg>
    </View>
  );
}
type ActivityBin = { x: number; value: number; epoch: number };
type ActivitySegment = { offset: string; bins: ActivityBin[] };
/** Sum only existing buckets within a contiguous segment. Never combine distinct
 * UTC-offset occurrences or bridge a missing bucket. Source totals are preserved. */
function pdfActivity(
  period: ComparisonPeriod,
  snapshot: ComparisonSnapshot,
) {
  const axis = activityAxis(snapshot);
  const base = snapshot.mode === 'hourly' ? 1 : 15;
  const binMinutes = Math.max(
    base,
    Math.ceil((axis.max - axis.min) / 160 / base) * base,
  );
  const segments: ActivitySegment[] = [];
  const offsetFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: snapshot.timeZone,
    timeZoneName: 'shortOffset',
  });
  let current: ActivitySegment | undefined,
    previousBin = -1,
    sourceIndex = 0;
  for (const point of activityPoints(period, snapshot)) {
    if (point.value[1] === null) {
      current = undefined;
      previousBin = -1;
      continue;
    }
    const bucket = period.timeline[sourceIndex++];
    const offset =
      offsetFormat
        .formatToParts(bucket.epoch)
        .find((part) => part.type === 'timeZoneName')?.value ??
      snapshot.timeZone;
    if (!current || current.offset !== offset) {
      current = { offset, bins: [] };
      segments.push(current);
      previousBin = -1;
    }
    const coordinate = point.value[0]!;
    const bin = Math.floor((coordinate - axis.min) / binMinutes);
    const previous = current.bins.at(-1);
    if (previous && previousBin === bin)
      previous.value += bucket[snapshot.metric];
    else {
      current.bins.push({
        x: coordinate,
        value: bucket[snapshot.metric],
        epoch: bucket.epoch,
      });
      previousBin = bin;
    }
  }
  return { segments, binMinutes };
}
function ActivityChart({
  snapshot,
  periods,
}: {
  snapshot: ComparisonSnapshot;
  periods: ComparisonPeriod[];
}) {
  const {
    palette,
    styles,
    activity: all,
    activityMaximum: maximum,
  } = usePdf();
  // Shared maxima across paginated chart sheets allow honest visual comparisons.
  const axis = activityAxis(snapshot),
    left = 66,
    right = 510,
    top = 12,
    bottom = 228;
  const x = (n: number) =>
    left +
    ((n - axis.min) / Math.max(1, axis.max - axis.min)) *
      (right - left);
  const y = (n: number) => bottom - (n / maximum) * (bottom - top);
  const tickCount = snapshot.mode === 'weekly' ? 7 : 4;
  const selected = all.filter((item) =>
    periods.some((p) => p.id === item.period.id),
  );
  return (
    <View>
      <Text style={styles.note}>
        Metric: {snapshot.metric}. At most six periods per chart;
        shared vertical scale across sheets. Each plotted value sums
        occupied source buckets within a local{' '}
        {selected[0]?.binMinutes ?? 1}-minute bin, separately for
        every contiguous UTC-offset segment; totals are preserved.
        Gaps remain absent, never zero.
      </Text>
      <View style={styles.panel} wrap={false}>
        <Svg
          width={WIDTH - 24}
          height={265}
          viewBox={`0 0 ${WIDTH} 265`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <G key={t}>
              <Line
                x1={left}
                x2={right}
                y1={y(maximum * t)}
                y2={y(maximum * t)}
                stroke={palette.border}
                strokeWidth={0.5}
              />
              <Text
                x={left - 8}
                y={y(maximum * t) + 3}
                textAnchor='end'
                style={{ fontSize: 7 }}
                fill={palette.mutedForeground}
              >
                {snapshot.metric === 'bytes'
                  ? formatBytes(maximum * t)
                  : new Intl.NumberFormat('en-US', {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(maximum * t)}
              </Text>
            </G>
          ))}
          {Array.from({ length: tickCount + 1 }, (_, i) => {
            const coordinate =
              axis.min + ((axis.max - axis.min) * i) / tickCount;
            return (
              <Text
                key={i}
                x={x(coordinate)}
                y={246}
                textAnchor={
                  i === 0
                    ? 'start'
                    : i === tickCount
                      ? 'end'
                      : 'middle'
                }
                style={{ fontSize: 7 }}
                fill={palette.mutedForeground}
              >
                {axis.label(coordinate)}
              </Text>
            );
          })}
          {selected.flatMap((item) => {
            const index = snapshot.result.periods.findIndex(
              (p) => p.id === item.period.id,
            );
            const style = seriesStyle(index, palette);
            const offsets = [
              ...new Set(
                item.segments.map((segment) => segment.offset),
              ),
            ];
            return item.segments.map((segment, i) => {
              const alternate = offsets.indexOf(segment.offset) > 0;
              const path = segment.bins
                .map(
                  (bin, j) =>
                    `${j ? 'L' : 'M'}${x(bin.x)},${y(bin.value)}`,
                )
                .join(' ');
              return (
                <G key={`${item.period.id}-${i}`}>
                  {segment.bins.length > 1 && (
                    <Path
                      d={path}
                      fill='none'
                      stroke={style.color}
                      strokeWidth={1.3}
                      strokeDasharray={alternate ? '2 2' : style.dash}
                    />
                  )}
                  {segment.bins.map((bin) =>
                    alternate ? (
                      <Rect
                        key={bin.epoch}
                        x={x(bin.x) - 1.8}
                        y={y(bin.value) - 1.8}
                        width={3.6}
                        height={3.6}
                        fill={style.color}
                      />
                    ) : (
                      <Circle
                        key={bin.epoch}
                        cx={x(bin.x)}
                        cy={y(bin.value)}
                        r={1.8}
                        fill={style.color}
                      />
                    ),
                  )}
                </G>
              );
            });
          })}
        </Svg>
      </View>
      {selected.map((item) => {
        const index = snapshot.result.periods.findIndex(
          (p) => p.id === item.period.id,
        );
        const style = seriesStyle(index, palette);
        const offsets = [
          ...new Set(item.segments.map((segment) => segment.offset)),
        ];
        return (
          <View
            key={item.period.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 5,
            }}
            wrap={false}
          >
            <Svg width={28} height={10}>
              <Line
                x1={0}
                x2={24}
                y1={5}
                y2={5}
                stroke={style.color}
                strokeWidth={1.5}
                strokeDasharray={style.dash}
              />
              <Circle cx={12} cy={5} r={2} fill={style.color} />
            </Svg>
            <Text style={{ fontSize: 8, marginLeft: 6 }}>
              {item.period.label} | {offsets.join(' → ')}
              {offsets.length > 1
                ? ' | offset change: square markers for later offset(s)'
                : ''}
            </Text>
          </View>
        );
      })}
      <Text style={styles.note}>
        Local clock alignment intentionally compares different dates.
        DST repetitions retain separate UTC-offset segments (never
        merged); squares mark later offsets within a period. Lines
        stop at missing buckets and clock jumps. A marker identifies
        an observed aggregate, not continuous log coverage. Exact
        local/UTC spans follow in period details.
      </Text>
    </View>
  );
}
function DiagnosticChart({
  snapshot,
  periods,
}: {
  snapshot: ComparisonSnapshot;
  periods: ComparisonPeriod[];
}) {
  const { palette, styles } = usePdf();
  const fields = [
    ['http4xx', 'HTTP 4xx'],
    ['http5xx', 'HTTP 5xx'],
    ['denied', 'Policy denials'],
    ['issues', 'Record issues'],
  ] as const;
  const max = fields.map(([field]) =>
    snapshot.result.periods.reduce(
      (n, p) => Math.max(n, p[field]),
      1,
    ),
  );
  const row = 38,
    height = 35 + periods.length * row;
  return (
    <View style={styles.panel} wrap={false}>
      <Svg
        width={WIDTH - 24}
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
      >
        {fields.map(([, name], i) => (
          <Text
            key={name}
            x={130 + i * 98}
            y={12}
            style={{ fontSize: 8 }}
            fill={palette.cardForeground}
          >
            {name}
          </Text>
        ))}
        {periods.map((p, index) => (
          <G key={p.id}>
            <Text
              x={0}
              y={37 + index * row}
              style={{ fontSize: 7.5 }}
              fill={palette.cardForeground}
            >
              {p.label}
            </Text>
            {fields.map(([field], column) => (
              <G key={field}>
                <Text
                  x={130 + column * 98}
                  y={34 + index * row}
                  style={{ fontSize: 7.5 }}
                  fill={palette.cardForeground}
                >
                  {number(p[field])}
                </Text>
                <Rect
                  x={130 + column * 98}
                  y={39 + index * row}
                  width={82}
                  height={7}
                  fill={palette.muted}
                />
                <Rect
                  x={130 + column * 98}
                  y={39 + index * row}
                  width={(82 * p[field]) / max[column]}
                  height={7}
                  fill={
                    field === 'http5xx'
                      ? palette.destructive
                      : palette.primary
                  }
                />
              </G>
            ))}
          </G>
        ))}
      </Svg>
    </View>
  );
}
export function TrafficComparisonDocument({
  snapshot,
  appearance,
}: {
  snapshot: ComparisonSnapshot;
  appearance: ComparisonPdfAppearance;
}) {
  const styles = reportStyles(appearance.palette);
  const periods = snapshot.result.periods;
  const activity = useMemo(
    () =>
      periods.map((period) => ({
        period,
        ...pdfActivity(period, snapshot),
      })),
    [snapshot],
  );
  const activityMaximum = activity.reduce(
    (maximum, item) =>
      item.segments.reduce(
        (n, segment) =>
          segment.bins.reduce((m, bin) => Math.max(m, bin.value), n),
        maximum,
      ),
    1,
  );
  return (
    <PdfContext.Provider
      value={{ ...appearance, styles, activity, activityMaximum }}
    >
      <Document
        title='Comparative Traffic Report'
        author='ProxyTools'
        subject='Historical indexed capture comparison'
        language='en'
        creationDate={new Date(appearance.exportedAt)}
      >
        <ExecutiveOverview snapshot={snapshot} />
        {chunks(periods, 10).map((page, index) => (
          <Sheet
            key={`volume-${index}`}
            snapshot={snapshot}
            title={`Volume comparison ${index + 1}`}
          >
            <Text style={styles.eyebrow}>
              OBSERVED VOLUME / SEPARATE SCALES
            </Text>
            <Text style={styles.heading}>
              Requests and bytes by period
            </Text>
            <Text style={styles.note}>
              Periods {index * 10 + 1}–{index * 10 + page.length} of{' '}
              {periods.length}. Every page uses the same scale for
              each metric. Real observed totals; no missing periods or
              partial intervals are imputed.
            </Text>
            <PeriodVolumeChart
              snapshot={snapshot}
              periods={page}
              metric='requests'
            />
            <PeriodVolumeChart
              snapshot={snapshot}
              periods={page}
              metric='bytes'
            />
          </Sheet>
        ))}
        {chunks(periods, 6).map((page, index) => (
          <Sheet
            key={`activity-${index}`}
            snapshot={snapshot}
            title={`Aligned activity ${index + 1}`}
          >
            <Text style={styles.eyebrow}>
              LOCAL CLOCK / {snapshot.timeZone}
            </Text>
            <Text style={styles.heading}>
              Aligned observed activity
            </Text>
            <ActivityChart snapshot={snapshot} periods={page} />
          </Sheet>
        ))}
        {chunks(periods, 10).map((page, index) => (
          <Sheet
            key={`diagnostics-${index}`}
            snapshot={snapshot}
            title={`HTTP and policy ${index + 1}`}
          >
            <Text style={styles.heading}>
              HTTP and policy outcomes
            </Text>
            <Text style={styles.note}>
              Independent request counts with separate column scales.
              Policy denials, HTTP status and record issues may
              overlap; columns must not be added together. Zero counts
              cannot certify that a field was available.
            </Text>
            <DiagnosticChart snapshot={snapshot} periods={page} />
          </Sheet>
        ))}
        <Sheet
          snapshot={snapshot}
          title='Periods and observed intervals'
        >
          <Text style={styles.heading}>
            Periods and observed intervals
          </Text>
          {periods.map((p, i) => (
            <PeriodSummary
              key={p.id}
              p={p}
              snapshot={snapshot}
              previous={periods[i - 1]}
            />
          ))}
        </Sheet>
        {periods.map((p) => (
          <Sheet key={p.id} snapshot={snapshot} title={p.label}>
            <Text style={styles.heading}>
              {p.label} / contributors
            </Text>
            <Text style={styles.note}>
              Top {snapshot.topN} by {snapshot.metric}. Both metrics
              are retained. Rankings do not prove causation; fields
              can be missing or multi-valued.
            </Text>
            {Object.entries(p.rankings).map(([field, entries]) => (
              <Ranking
                key={field}
                title={fieldLabels[field] || field}
                entries={entries}
              />
            ))}
          </Sheet>
        ))}
        <Sheet snapshot={snapshot} title='Common entities'>
          <Text style={styles.heading}>
            Entities common to all observed periods
          </Text>
          <Text style={styles.note}>
            Membership is calculated from complete period entity sets
            before ranking, rather than intersecting independent Top N
            lists.
          </Text>
          {Object.entries(snapshot.result.common).map(
            ([field, entries]) => (
              <View key={field} style={{ marginBottom: 14 }}>
                <Text style={styles.subheading} minPresenceAhead={45}>
                  {fieldLabels[field] || field}
                </Text>
                {!entries.length && (
                  <Text style={styles.note}>
                    No common populated entities.
                  </Text>
                )}
                {entries.map((e) => (
                  <View key={e.name} style={{ marginBottom: 8 }}>
                    <Text
                      style={{ fontWeight: 600, fontSize: 9 }}
                      minPresenceAhead={30}
                    >
                      {label(e.name)}
                    </Text>
                    {e.values.map((v) => (
                      <View
                        key={v.periodId}
                        style={styles.row}
                        wrap={false}
                      >
                        <Text style={styles.name}>
                          {periods.find((p) => p.id === v.periodId)
                            ?.label || v.periodId}
                        </Text>
                        <Text style={styles.requests}>
                          {number(v.requests)}
                        </Text>
                        <Text style={styles.bytes}>
                          {number(v.bytes)} B
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ),
          )}
        </Sheet>
        {snapshot.result.changes &&
          Object.keys(snapshot.result.changes).length > 0 && (
            <Sheet
              snapshot={snapshot}
              title='Entity presence changes'
            >
              <Text style={styles.heading}>
                Emerging and disappeared entities
              </Text>
              <Text style={styles.note}>
                Presence is compared across complete entity sets in
                successive observed periods. The lists show up to{' '}
                {snapshot.topN} contributors ranked by{' '}
                {snapshot.metric}. Emerging means observed only in the
                later selected period; disappeared means observed only
                in the earlier one. Different capture coverage may
                explain either result.
              </Text>
              {Object.entries(snapshot.result.changes).map(
                ([field, changes]) => (
                  <View key={field}>
                    <Text
                      style={styles.heading}
                      minPresenceAhead={65}
                    >
                      {fieldLabels[field] || field}
                    </Text>
                    {changes.map((c) => (
                      <View
                        key={`${c.fromPeriod}-${c.toPeriod}`}
                        style={{ marginBottom: 12 }}
                      >
                        <Text
                          style={styles.subheading}
                          minPresenceAhead={50}
                        >
                          {periods.find((p) => p.id === c.fromPeriod)
                            ?.label || c.fromPeriod}{' '}
                          to{' '}
                          {periods.find((p) => p.id === c.toPeriod)
                            ?.label || c.toPeriod}
                        </Text>
                        <Ranking
                          title='Emerging / later-period totals'
                          entries={c.emerged}
                        />
                        <Ranking
                          title='Disappeared / earlier-period totals'
                          entries={c.disappeared}
                        />
                      </View>
                    ))}
                  </View>
                ),
              )}
            </Sheet>
          )}
        {snapshot.original && (
          <Sheet snapshot={snapshot} title='Original observed totals'>
            <Text style={styles.heading}>
              Original observed totals
            </Text>
            <Text style={styles.note}>
              Values before restricting the comparison to the common
              time interval.
            </Text>
            {snapshot.original.periods.map((p) => (
              <PeriodSummary key={p.id} p={p} snapshot={snapshot} />
            ))}
          </Sheet>
        )}
        <Sheet snapshot={snapshot} title='Source provenance'>
          <Text style={styles.heading}>
            Source provenance and limits
          </Text>
          <Text style={styles.note}>
            Statistics use read-only SQL over saved indexed captures.
            No raw logs are downloaded or reparsed. Potentially
            overlapping capture sets are rejected when record
            uniqueness cannot be established.
          </Text>
          {snapshot.result.sources.map((s) => (
            <View key={s.id} style={styles.panel}>
              <Text style={styles.subheading}>{label(s.source)}</Text>
              <Text style={styles.note}>Capture: {s.id}</Text>
              <Text>
                Assignment:{' '}
                {s.scope
                  ? `${s.scope.profile} / ${label(s.scope.proxyIdentity)}`
                  : 'Unassigned - explicitly selected'}
              </Text>
              <Text>
                Indexed records: {number(s.records)} | Records without
                usable timestamps: {number(s.untimedRecords)}
              </Text>
              <Text>
                Ingestion diagnostics:{' '}
                {s.diagnosticsTotal === undefined
                  ? 'unavailable'
                  : number(s.diagnosticsTotal)}{' '}
                | Without record assignment:{' '}
                {s.unassignedDiagnostics === undefined
                  ? 'unavailable'
                  : number(s.unassignedDiagnostics)}
              </Text>
              <Text style={styles.note}>
                Observed source range:{' '}
                {s.first === null
                  ? 'unavailable'
                  : time(snapshot, s.first)}{' '}
                -{' '}
                {s.last === null
                  ? 'unavailable'
                  : time(snapshot, s.last)}
              </Text>
              <Text style={styles.subheading} minPresenceAhead={40}>
                Source field availability
              </Text>
              {(s.fieldAvailability ?? []).map((f) => (
                <View key={f.name} style={styles.row} wrap={false}>
                  <Text style={styles.name}>{label(f.name)}</Text>
                  <Text style={styles.requests}>{f.status}</Text>
                  <Text style={styles.bytes}>
                    {number(f.populated)} / {number(f.total)}
                  </Text>
                </View>
              ))}
              {!s.fieldAvailability?.length && (
                <Text style={styles.note}>
                  Availability metadata unavailable.
                </Text>
              )}
            </View>
          ))}
          <Text style={styles.note}>{COMPARISON_NOTE}</Text>
          <Text style={styles.note}>
            Field availability is limited by the original capture. An
            empty ranking means no populated values were returned; it
            does not establish that an application, user, action or
            category was absent from the original traffic. Policy
            denial counts follow the indexed policy classification,
            independently of HTTP status.
          </Text>
        </Sheet>
      </Document>
    </PdfContext.Provider>
  );
}
export async function comparisonReportBlob(
  snapshot: ComparisonSnapshot,
  appearance: ComparisonPdfAppearance,
): Promise<Blob> {
  registerTrafficReportFonts();
  return pdf(
    <TrafficComparisonDocument
      snapshot={snapshot}
      appearance={appearance}
    />,
  ).toBlob();
}
