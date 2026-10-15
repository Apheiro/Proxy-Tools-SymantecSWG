import type {
  TraceEntry,
  TraceTime,
  TraceVerdict,
  traceRelations,
} from '@/lib/policyTrace';

export const TRACE_GROUPING_KEY = 'policy-trace-grouping';
export type TraceGrouping = 'none' | 'flow';
type Relations = ReturnType<typeof traceRelations>;
type FlowRoot = {
  key: string;
  anchor: TraceEntry;
  missingParent?: string;
  issue?: string;
};
export type TraceFlow = FlowRoot & {
  entries: { entry: TraceEntry; depth: number }[];
  first?: TraceTime;
  last?: TraceTime;
  counts: Record<TraceVerdict, number>;
};
export type TraceDisplayRow =
  | {
      kind: 'flow';
      key: string;
      flow: TraceFlow;
      shown: number;
      expanded: boolean;
    }
  | {
      kind: 'transaction';
      key: string;
      entry: TraceEntry;
      depth?: number;
    };

const chronological = (a: TraceEntry, b: TraceEntry) =>
  (a.timestamp.epoch ?? Infinity) - (b.timestamp.epoch ?? Infinity) ||
  a.key.localeCompare(b.key);

/** Follow only explicit, unambiguous parent references. Iteration also handles deep chains and cycles. */
export function groupTraceFlows(
  entries: TraceEntry[],
  relations: Relations,
): TraceFlow[] {
  const roots = new Map<string, FlowRoot>();
  for (const entry of entries) {
    if (roots.has(entry.key)) continue;
    const path: TraceEntry[] = [];
    const positions = new Map<string, number>();
    let current = entry;
    let root: FlowRoot;
    while (true) {
      const known = roots.get(current.key);
      if (known) {
        root = known;
        break;
      }
      const cycleStart = positions.get(current.key);
      if (cycleStart !== undefined) {
        const anchor = path
          .slice(cycleStart)
          .reduce((a, b) => (a.key < b.key ? a : b));
        root = {
          key: `cycle:${anchor.key}`,
          anchor,
          issue: 'Cyclic handoff references · origin unresolved',
        };
        break;
      }
      positions.set(current.key, path.length);
      path.push(current);
      const parent = relations.parents.get(current.key);
      if (parent?.entry) {
        current = parent.entry;
        continue;
      }
      root =
        parent?.note === 'Not in this capture'
          ? {
              key: `missing:${parent.id}`,
              anchor: current,
              missingParent: parent.id,
            }
          : {
              key: `root:${current.key}`,
              anchor: current,
              issue: parent?.note,
            };
      break;
    }
    for (const member of path) roots.set(member.key, root);
  }
  const groups = new Map<string, TraceFlow>();
  for (const entry of entries) {
    const root = roots.get(entry.key)!;
    let flow = groups.get(root.key);
    if (!flow) {
      flow = {
        ...root,
        entries: [],
        counts: { allowed: 0, rejected: 0, exception: 0, unknown: 0 },
      };
      groups.set(root.key, flow);
    }
    flow.entries.push({ entry, depth: 0 });
    flow.counts[entry.outcome.verdict]++;
    if (entry.timestamp.epoch != null) {
      if (!flow.first || entry.timestamp.epoch < flow.first.epoch!)
        flow.first = entry.timestamp;
      if (!flow.last || entry.timestamp.epoch > flow.last.epoch!)
        flow.last = entry.timestamp;
    }
  }
  for (const flow of groups.values()) {
    const members = new Set(
      flow.entries.map(({ entry }) => entry.key),
    );
    const starts = flow.entries
      .map(({ entry }) => entry)
      .filter(
        (entry) =>
          !members.has(relations.parents.get(entry.key)?.entry?.key),
      );
    const visited = new Set<string>();
    const ordered: TraceFlow['entries'] = [];
    const walk = (initial: TraceEntry[]) => {
      const stack = initial
        .sort(chronological)
        .reverse()
        .map((entry) => ({ entry, depth: 0 }));
      while (stack.length) {
        const row = stack.pop()!;
        if (visited.has(row.entry.key)) continue;
        visited.add(row.entry.key);
        ordered.push(row);
        const children = (relations.children.get(row.entry.key) ?? [])
          .map((child) => child.entry!)
          .filter((child) => members.has(child.key))
          .sort(chronological);
        for (let i = children.length - 1; i >= 0; i--)
          stack.push({ entry: children[i], depth: row.depth + 1 });
      }
    };
    walk(starts);
    // A cyclic trace has no proven start; retain all evidence without inventing an origin.
    if (visited.size < members.size)
      walk(
        flow.entries
          .map(({ entry }) => entry)
          .filter((entry) => !visited.has(entry.key)),
      );
    // Newest records first; equal timestamps retain the latest processing stage first.
    flow.entries = ordered
      .reverse()
      .sort(
        (a, b) =>
          (b.entry.timestamp.epoch ?? -Infinity) -
            (a.entry.timestamp.epoch ?? -Infinity) || 0,
      );
  }
  return [...groups.values()].sort(
    (a, b) =>
      (b.last?.epoch ?? -Infinity) - (a.last?.epoch ?? -Infinity) ||
      a.key.localeCompare(b.key),
  );
}

/** Filter after correlation so hidden ancestors never split a captured flow. */
export function traceDisplayRows(
  entries: TraceEntry[],
  flows: TraceFlow[],
  collapsed: ReadonlySet<string>,
  grouping: TraceGrouping,
): TraceDisplayRow[] {
  if (grouping === 'none')
    return entries.map((entry) => ({
      kind: 'transaction',
      key: entry.key,
      entry,
    }));
  const visible = new Set(entries.map((entry) => entry.key));
  const rows: TraceDisplayRow[] = [];
  for (const flow of flows) {
    const matches = flow.entries.filter(({ entry }) =>
      visible.has(entry.key),
    );
    if (!matches.length) continue;
    const expanded = !collapsed.has(flow.key);
    rows.push({
      kind: 'flow',
      key: `flow:${flow.key}`,
      flow,
      shown: matches.length,
      expanded,
    });
    if (expanded)
      for (const row of matches)
        rows.push({
          kind: 'transaction',
          key: row.entry.key,
          ...row,
        });
  }
  return rows;
}
