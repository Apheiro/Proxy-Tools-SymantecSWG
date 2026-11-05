import {
  Document,
  Page,
  pdf,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer';
import type { ReactNode } from 'react';
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
import { registerTrafficReportFonts } from './trafficReportDocument';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'ProxyToolsReport',
    fontSize: 9,
    lineHeight: 1.5,
    color: '#182332',
    backgroundColor: '#ffffff',
    paddingTop: 60,
    paddingBottom: 52,
    paddingHorizontal: 36,
  },
  header: {
    position: 'absolute',
    top: 26,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#627184',
  },
  footer: {
    position: 'absolute',
    top: 808,
    height: 18,
    left: 36,
    width: 523,
    fontSize: 7,
    lineHeight: 1.4,
    color: '#627184',
  },
  eyebrow: {
    fontSize: 8,
    letterSpacing: 1,
    color: '#627184',
    marginBottom: 6,
  },
  title: {
    fontSize: 25,
    lineHeight: 1.5,
    fontWeight: 600,
    marginBottom: 12,
  },
  heading: { fontSize: 14, fontWeight: 600, marginBottom: 9 },
  subheading: { fontSize: 10, fontWeight: 600, marginBottom: 6 },
  note: { fontSize: 8, color: '#627184', marginBottom: 8 },
  panel: {
    borderWidth: 1,
    borderColor: '#dce3eb',
    borderRadius: 6,
    backgroundColor: '#f6f8fb',
    padding: 11,
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#dce3eb',
    borderRadius: 6,
  },
  value: {
    fontSize: 20,
    lineHeight: 1.5,
    fontWeight: 600,
    marginTop: 3,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#dce3eb',
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableHead: { backgroundColor: '#edf2f7', fontWeight: 600 },
  name: { width: '55%', paddingRight: 7, fontSize: 8 },
  requests: { width: '21%', textAlign: 'right', fontSize: 8 },
  bytes: { width: '24%', textAlign: 'right', fontSize: 8 },
});
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
  return (
    <Page size='A4' style={styles.page} wrap>
      <View fixed style={styles.header}>
        <Text>PROXYTOOLS / COMPARATIVE REPORTS</Text>
        <Text>{snapshot.metric.toUpperCase()}</Text>
      </View>
      <View fixed style={styles.footer}>
        <Text>
          {snapshot.timeZone} | {title}
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
  const rate = comparisonRate(p, 'requests');
  const byteRate = comparisonRate(p, 'bytes');
  return (
    <View style={styles.panel} wrap={false}>
      <Text style={styles.subheading}>{p.label}</Text>
      <Text>
        Requests: {number(p.requests)} | Bytes: {formatBytes(p.bytes)}
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
        {byteRate === null
          ? 'N/A'
          : `${formatBytes(Math.round(byteRate))}/s`}{' '}
        | Active minutes: {number(p.activeMinutes)}
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
          <Text style={styles.bytes}>{formatBytes(e.bytes)}</Text>
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
function Chart({ snapshot }: { snapshot: ComparisonSnapshot }) {
  const periods = snapshot.result.periods;
  const maximum = Math.max(
    1,
    ...periods.map((p) => p[snapshot.metric]),
  );
  // Split charts into small sheets of rows; no labels or periods are dropped.
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.subheading} minPresenceAhead={50}>
        {snapshot.metric === 'bytes' ? 'Traffic volume' : 'Requests'}{' '}
        by period
      </Text>
      <Text style={styles.note}>
        Shared scale. Actual observed totals; partial intervals are
        not imputed.
      </Text>
      {periods.map((p) => (
        <View key={p.id} style={{ marginBottom: 7 }} wrap={false}>
          <Text style={{ fontSize: 8 }}>
            {p.label} |{' '}
            {snapshot.metric === 'bytes'
              ? formatBytes(p.bytes)
              : number(p.requests)}
          </Text>
          <Svg width={515} height={12} viewBox='0 0 515 12'>
            <Rect
              x={0}
              y={1}
              width={515}
              height={10}
              fill='#edf2f7'
            />
            <Rect
              x={0}
              y={1}
              width={(p[snapshot.metric] / maximum) * 515}
              height={10}
              fill='#3975d0'
            />
          </Svg>
        </View>
      ))}
    </View>
  );
}
export function TrafficComparisonDocument({
  snapshot,
}: {
  snapshot: ComparisonSnapshot;
}) {
  const periods = snapshot.result.periods;
  const totals = periods.reduce(
    (a, p) => ({
      requests: a.requests + p.requests,
      bytes: a.bytes + p.bytes,
    }),
    { requests: 0, bytes: 0 },
  );
  return (
    <Document
      title='Comparative Traffic Report'
      author='ProxyTools'
      subject='Historical indexed capture comparison'
      language='en'
    >
      <Sheet snapshot={snapshot} title='Executive overview'>
        <Text style={styles.eyebrow}>
          PROXY DIAGNOSTICS / HISTORICAL TRAFFIC
        </Text>
        <Text style={styles.title}>Comparative Reports</Text>
        <View style={styles.panel}>
          <Text style={styles.subheading}>
            {label(snapshot.proxy)} | {snapshot.profile}
          </Text>
          <Text>
            Generated:{' '}
            {time(snapshot, Date.parse(snapshot.generatedAt))}
          </Text>
          <Text>
            Mode: {snapshot.mode} | Time zone: {snapshot.timeZone}
          </Text>
          <Text>
            Daily window:{' '}
            {snapshot.mode === 'hourly'
              ? `${snapshot.from} - ${snapshot.to}`
              : 'entire local days'}{' '}
            | Date filter:{' '}
            {snapshot.dateFrom || 'automatic first day'} -{' '}
            {snapshot.dateTo || 'automatic last day'}
          </Text>
          <Text>
            Ranking: top {snapshot.topN} by {snapshot.metric} | Common
            interval:{' '}
            {snapshot.commonInterval
              ? 'enabled (original totals retained below)'
              : 'disabled'}
          </Text>
          {snapshot.mode === 'weekly' && (
            <Text style={styles.note}>
              Calendar weeks run Monday to Sunday in the selected time
              zone. A week with only some observed days remains
              partial; event timestamps do not establish complete
              ingestion.
            </Text>
          )}
        </View>
        <View style={styles.grid}>
          <View style={styles.stat}>
            <Text style={styles.note}>Periods with events</Text>
            <Text style={styles.value}>{periods.length}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.note}>Requests</Text>
            <Text style={styles.value}>
              {number(totals.requests)}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.note}>Traffic volume</Text>
            <Text style={styles.value}>
              {formatBytes(totals.bytes)}
            </Text>
          </View>
        </View>
        <Text style={styles.note}>
          {snapshot.result.excluded} candidate periods excluded
          because no event was observed in the selected window.
          Missing calendar dates are not inserted as zeros.
        </Text>
        <Chart snapshot={snapshot} />
        <Text style={styles.heading}>Comparability</Text>
        <Text style={styles.note}>{COMPARISON_NOTE}</Text>
        <Text style={styles.note}>
          Totals describe selected indexed events. Unique entities are
          counted per consolidated period and are not added across
          periods. Unknown or unpopulated fields may limit
          comparisons. Parse diagnostics without event timestamps
          remain source-level information.
        </Text>
      </Sheet>
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
          <Text style={styles.heading}>{p.label} / contributors</Text>
          <Text style={styles.note}>
            Top {snapshot.topN} by {snapshot.metric}. Both metrics are
            retained. Rankings do not prove causation; fields can be
            missing or multi-valued.
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
                        {formatBytes(v.bytes)}
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
          <Sheet snapshot={snapshot} title='Entity presence changes'>
            <Text style={styles.heading}>
              Emerging and disappeared entities
            </Text>
            <Text style={styles.note}>
              Presence is compared across complete entity sets in
              successive observed periods. The lists show up to{' '}
              {snapshot.topN} contributors ranked by {snapshot.metric}
              . Emerging means observed only in the later selected
              period; disappeared means observed only in the earlier
              one. Different capture coverage may explain either
              result.
            </Text>
            {Object.entries(snapshot.result.changes).map(
              ([field, changes]) => (
                <View key={field}>
                  <Text style={styles.heading} minPresenceAhead={65}>
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
          <Text style={styles.heading}>Original observed totals</Text>
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
          Statistics use read-only SQL over saved indexed captures. No
          raw logs are downloaded or reparsed. Potentially overlapping
          capture sets are rejected when record uniqueness cannot be
          established.
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
          category was absent from the original traffic. Policy denial
          counts follow the indexed policy classification,
          independently of HTTP status.
        </Text>
      </Sheet>
    </Document>
  );
}
export async function comparisonReportBlob(
  snapshot: ComparisonSnapshot,
): Promise<Blob> {
  registerTrafficReportFonts();
  return pdf(
    <TrafficComparisonDocument snapshot={snapshot} />,
  ).toBlob();
}
