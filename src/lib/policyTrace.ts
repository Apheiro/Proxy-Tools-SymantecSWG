import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);

export type TraceVerdict =
  | 'allowed'
  | 'rejected'
  | 'exception'
  | 'unknown';
export type TraceOutcome = {
  verdict: TraceVerdict;
  label: string;
  evidence: string;
  source: 'reported' | 'matched' | 'none';
};
export type TraceTime = {
  epoch: number | null;
  date: string;
  time: string;
  zone: string;
};
export type TraceEntry = {
  key: string;
  log: TransactionInfo;
  raw: string;
  outcome: TraceOutcome;
  timestamp: TraceTime;
};
export type TraceRelation = {
  id: string;
  entry?: TraceEntry;
  note?: string;
};

export function policyLineVerdict(line: string): TraceVerdict {
  if (/^\s*(?:miss|n\/a|late)\s*:/i.test(line)) return 'unknown';
  // Ignore names and quoted condition values that happen to contain action words.
  const actions = line
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '')
    .replace(/^\s*MATCH:\s*/i, '');
  if (/(?:^|\s)EXCEPTION(?=\s|$|\()/i.test(actions))
    return 'exception';
  if (
    /(?:^|\s)(?:DENY|DENIED|REJECT|REJECTED)(?=\s|$|[;(])/i.test(
      actions,
    )
  )
    return 'rejected';
  if (/(?:^|\s)(?:ALLOW|ALLOWED)(?=\s|$|[;(])/i.test(actions))
    return 'allowed';
  return 'unknown';
}

export function traceOutcome(log: TransactionInfo): TraceOutcome {
  const reported = log.decision?.verdict?.trim();
  if (reported) {
    const action = reported
      .match(
        /^(ALLOW(?:ED)?|DENY|DENIED|REJECT(?:ED)?|EXCEPTION)(?=$|\s|[:;(])/i,
      )?.[1]
      .toUpperCase();
    const verdict: TraceVerdict = action?.startsWith('ALLOW')
      ? 'allowed'
      : action === 'EXCEPTION'
        ? 'exception'
        : action
          ? 'rejected'
          : 'unknown';
    return {
      verdict,
      label: {
        allowed: 'Allowed',
        rejected: 'Denied',
        exception: 'Exception',
        unknown: 'Unclassified',
      }[verdict],
      evidence: reported,
      source: 'reported',
    };
  }
  const actions = (log.policyMatches ?? [])
    .flatMap((group) => group.matches ?? [])
    .map((line) => ({ line, verdict: policyLineVerdict(line) }));
  const action = ['exception', 'rejected', 'allowed']
    .map((verdict) =>
      actions.find((item) => item.verdict === verdict),
    )
    .find(Boolean);
  if (action)
    return {
      verdict: action.verdict,
      label: {
        allowed: 'Matched allow',
        rejected: 'Matched deny',
        exception: 'Matched exception',
        unknown: 'Not reported',
      }[action.verdict],
      evidence: action.line,
      source: 'matched',
    };
  return {
    verdict: 'unknown',
    label: 'Not reported',
    evidence:
      'No final verdict or explicit matched action was recorded.',
    source: 'none',
  };
}

export function traceTime(value?: string | null): TraceTime {
  const missing = {
    epoch: null,
    date: 'Not recorded',
    time: '—',
    zone: '',
  };
  if (!value?.trim()) return missing;
  const text = value.trim();
  const utcText = text
    .replace(/\s+(?:UTC|GMT)$/i, 'Z')
    .replace(/^(\d{4}-\d\d-\d\d)\s+/, '$1T');
  const zoned =
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)$/i.test(
      utcText,
    );
  if (
    zoned &&
    !dayjs(
      utcText.slice(0, 19),
      'YYYY-MM-DDTHH:mm:ss',
      true,
    ).isValid()
  )
    return missing;
  const parsed = zoned
    ? dayjs(utcText).utc()
    : dayjs(
        text,
        ['YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss'],
        true,
      );
  if (!parsed.isValid()) return missing;
  return {
    epoch: parsed.valueOf(),
    date: parsed.format('DD MMM YYYY'),
    time: parsed.format('HH:mm:ss'),
    zone: zoned ? 'UTC' : 'Appliance time (zone not reported)',
  };
}

export function traceEntry(
  log: TransactionInfo,
  raw: string,
): TraceEntry {
  return {
    key: JSON.stringify([
      log.transaction.id,
      log.transaction.type,
      log.connection.time,
    ]),
    log,
    raw,
    outcome: traceOutcome(log),
    timestamp: traceTime(log.connection.time),
  };
}

export function mergeTraceEntries(
  previous: TraceEntry[],
  incoming: TraceEntry[],
) {
  const entries = new Map(
    previous.map((entry) => [entry.key, entry]),
  );
  for (const entry of incoming) entries.set(entry.key, entry);
  return [...entries.values()].sort(
    (a, b) =>
      (b.timestamp.epoch ?? -Infinity) -
        (a.timestamp.epoch ?? -Infinity) || 0,
  );
}

export function traceRelations(entries: TraceEntry[]) {
  const byId = new Map<string, TraceEntry[]>();
  const children = new Map<string, TraceRelation[]>();
  for (const entry of entries) {
    const id = entry.log.transaction.id;
    if (id) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id)!.push(entry);
    }
  }
  const parents = new Map<string, TraceRelation>();
  for (const entry of entries) {
    const id = entry.log.transaction.pid;
    if (!id) continue;
    const candidates = byId.get(id) ?? [];
    const parent =
      candidates.length === 1 && candidates[0].key !== entry.key
        ? candidates[0]
        : undefined;
    parents.set(entry.key, {
      id,
      entry: parent,
      note: parent
        ? undefined
        : candidates.length
          ? 'Ambiguous or self reference'
          : 'Not in this capture',
    });
    if (parent) {
      if (!children.has(parent.key)) children.set(parent.key, []);
      children
        .get(parent.key)!
        .push({ id: entry.log.transaction.id, entry });
    }
  }
  return { parents, children };
}

export function traceDuration(log: TransactionInfo) {
  const total =
    log.timing?.totalTransactionTimeMs ??
    log.timing?.checkpoints?.['stop-transaction']?.startMs;
  return typeof total === 'number' && Number.isFinite(total)
    ? `${total.toLocaleString()} ms`
    : 'Not recorded';
}
