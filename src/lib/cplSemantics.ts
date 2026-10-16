import {
  capabilityFor,
  type PolicyColumn,
} from '@/lib/cplCapabilities';
import {
  type CplAtom,
  type CplDefinition,
  type CplDocument,
  definitionRows,
  parseAtoms,
  parseCpl,
  patchCpl,
} from '@/lib/cplDocument';
export interface PolicySymbol {
  definition: CplDefinition;
  rows: ReturnType<typeof definitionRows>;
  references: { name: string; line: number }[];
  uses: number[];
  columns: Set<PolicyColumn>;
  issues: string[];
}
export interface PolicyIndex {
  document: CplDocument;
  symbols: Map<string, PolicySymbol>;
  issues: string[];
}
const unquote = (name: string) => name.replace(/^["']|["']$/g, '');
export function referenceName(atom: CplAtom) {
  if (atom.name.toLowerCase() === 'condition')
    return unquote(atom.value.replace(/^!/, ''));
  if (atom.name.startsWith('action.'))
    return unquote(atom.name.slice(7));
  return null;
}
export function indexPolicy(
  source: string,
  document = parseCpl(source),
): PolicyIndex {
  const symbols = new Map<string, PolicySymbol>();
  const issues: string[] = [];
  const ambiguous = new Set<string>();
  for (const definition of document.definitions) {
    const name = unquote(definition.name);
    if (symbols.has(name)) {
      issues.push(`Duplicate object: ${name}`);
      ambiguous.add(name);
    }
    const rows = definitionRows(source, definition);
    symbols.set(name, {
      definition,
      rows,
      references: rows.flatMap((r) =>
        r.atoms.flatMap((a) =>
          referenceName(a)
            ? [{ name: referenceName(a)!, line: r.line }]
            : [],
        ),
      ),
      uses: [],
      columns: new Set(),
      issues: [],
    });
  }
  for (const rule of [
    ...document.layers.flatMap((l) => [
      ...l.rules,
      { line: l.line, atoms: parseAtoms(l.guard).atoms },
    ]),
    ...[...symbols.values()].flatMap((s) => s.rows),
  ]) {
    for (const atom of rule.atoms) {
      const name = referenceName(atom);
      if (name) symbols.get(name)?.uses.push(rule.line);
    }
  }
  const done = new Set<string>();
  function visit(name: string, path: Set<string>): Set<PolicyColumn> {
    const symbol = symbols.get(name);
    if (!symbol || ambiguous.has(name)) return new Set(['advanced']);
    if (path.size > 64) {
      symbol.issues.push(
        'Dependency depth exceeds 64; this expression remains compound.',
      );
      return new Set(['advanced']);
    }
    if (path.has(name)) {
      symbol.issues.push(`Cyclic reference involving ${name}`);
      return new Set(['advanced']);
    }
    if (done.has(name)) return symbol.columns;
    const next = new Set(path).add(name);
    for (const atom of symbol.rows.flatMap((r) => r.atoms)) {
      const ref = referenceName(atom);
      if (ref) {
        if (!symbols.has(ref))
          symbol.issues.push(
            `Reference ${ref} is not defined in this CPL; it may belong to another policy source.`,
          );
        for (const col of visit(ref, next)) symbol.columns.add(col);
      } else
        symbol.columns.add(
          capabilityFor(atom.name)?.column ||
            (atom.kind === 'condition' ? 'advanced' : 'action'),
        );
    }
    if (!symbol.columns.size) symbol.columns.add('advanced');
    done.add(name);
    return symbol.columns;
  }
  for (const name of symbols.keys()) visit(name, new Set());
  return { document, symbols, issues };
}
export function columnFor(
  atom: CplAtom,
  index?: PolicyIndex,
): PolicyColumn {
  const ref = referenceName(atom);
  if (ref) {
    if (atom.kind === 'action') return 'action';
    const columns = index?.symbols.get(ref)?.columns;
    return columns?.size === 1 ? [...columns][0] : 'advanced';
  }
  return (
    capabilityFor(atom.name)?.column ||
    (atom.kind === 'condition' ? 'advanced' : 'action')
  );
}
export function describeAtom(atom: CplAtom) {
  const capability = capabilityFor(atom.name);
  if (atom.form === 'bare') return capability?.label || atom.name;
  const ref = referenceName(atom);
  if (ref)
    return `${atom.value.startsWith('!') || atom.operator === '!=' ? 'NOT ' : ''}${ref}`;
  return `${capability?.label || atom.name}${atom.operator === '!=' ? ' ≠ ' : ': '}${atom.value}`;
}
/** Bulk edit only recognized rows; retain unrelated comments and the definition's original delimiters. */
export function replaceObjectRows(
  source: string,
  definition: CplDefinition,
  desired: string[],
) {
  if (!definition.complete) throw new Error('Unterminated object.');
  const rows = definitionRows(source, definition);
  if (!desired.length)
    throw new Error('An object must contain at least one row.');
  if (rows.some((r) => !r.editable))
    throw new Error(
      'This object contains preserved statements. Use source mode.',
    );
  for (const row of desired) {
    const parsed = parseAtoms(row);
    if (
      !parsed.complete ||
      !parsed.atoms.length ||
      parsed.comment ||
      /[\r\n]/.test(row)
    )
      throw new Error(
        'Each object row must contain valid single-line expressions.',
      );
    if (
      definition.kind.toLowerCase() === 'condition' &&
      parsed.atoms.some((a) => a.kind !== 'condition')
    )
      throw new Error('Conditions cannot contain actions.');
  }
  if (
    rows.length === desired.length &&
    rows.every(
      (r, i) => r.atoms.map((a) => a.raw).join(' ') === desired[i],
    )
  )
    return source;
  const newline = source
    .slice(definition.start, definition.end)
    .includes('\r\n')
    ? '\r\n'
    : '\n';
  let next = source;
  if (desired.length > rows.length)
    next = patchCpl(
      next,
      definition.bodyEnd,
      definition.bodyEnd,
      desired
        .slice(rows.length)
        .map((r) => `    ${r}${newline}`)
        .join(''),
    );
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (i >= desired.length) {
      // Leave operational comments in place even when their associated row is removed.
      const suffix = row.comment
        ? `${source.slice(row.codeStart, row.atoms[0].start)}${row.comment}${newline}`
        : '';
      next = patchCpl(next, row.codeStart, row.end, suffix);
    } else if (row.atoms.map((a) => a.raw).join(' ') !== desired[i]) {
      const indentation = source.slice(
        row.codeStart,
        row.atoms[0].start,
      );
      next = patchCpl(
        next,
        row.codeStart,
        row.end,
        indentation +
          desired[i] +
          (row.comment ? ` ${row.comment}` : '') +
          (row.raw.endsWith('\n') ? newline : ''),
      );
    }
  }
  return next;
}

export function renamePolicyObject(
  source: string,
  definition: CplDefinition,
  newName: string,
) {
  if (!/^[A-Za-z_][\w.-]*$/.test(newName))
    throw new Error(
      'Use letters, digits, underscore or hyphen in the object name.',
    );
  const index = indexPolicy(source);
  const old = unquote(definition.name);
  if (newName === old) return source;
  if (index.symbols.has(newName))
    throw new Error('An object with this name already exists.');
  if (
    index.document.protected.some((p) =>
      source.slice(p.start, p.end).includes(old),
    ) ||
    index.document.layers.some((l) =>
      l.rules.some(
        (r) => (!r.editable || r.disabled) && r.raw.includes(old),
      ),
    )
  )
    throw new Error(
      'Preserved source may reference this name. Rename it in source mode after reviewing all references.',
    );
  const edits: { start: number; end: number; text: string }[] = [];
  const header = source.slice(definition.start, definition.bodyStart);
  const position = header.indexOf(
    definition.name,
    header.toLowerCase().indexOf(definition.kind.toLowerCase()) +
      definition.kind.length,
  );
  if (position < 0)
    throw new Error('Cannot locate the object declaration.');
  edits.push({
    start: definition.start + position,
    end: definition.start + position + definition.name.length,
    text: newName,
  });
  const terminator = source.slice(definition.bodyEnd, definition.end);
  const endCode = terminator.split(';')[0].trim();
  const namedEnd =
    endCode.toLowerCase() ===
      `end ${definition.kind} ${definition.name}`.toLowerCase() ||
    (endCode.toLowerCase() ===
      `end ${definition.name}`.toLowerCase() &&
      definition.name.toLowerCase() !==
        definition.kind.toLowerCase());
  if (namedEnd) {
    const offset = terminator
      .toLowerCase()
      .indexOf(
        definition.name.toLowerCase(),
        terminator.toLowerCase().indexOf('end') +
          3 +
          (endCode.toLowerCase() ===
          `end ${definition.kind} ${definition.name}`.toLowerCase()
            ? definition.kind.length + 1
            : 0),
      );
    edits.push({
      start: definition.bodyEnd + offset,
      end: definition.bodyEnd + offset + definition.name.length,
      text: newName,
    });
  }
  // Header atoms are parsed from their exact untrimmed suffix to preserve offsets.
  const ruleAtoms = [
    ...index.document.layers.flatMap((l) =>
      l.rules.flatMap((r) => r.atoms),
    ),
    ...[...index.symbols.values()].flatMap((s) =>
      s.rows.flatMap((r) => r.atoms),
    ),
  ];
  const guards = index.document.layers.flatMap((l) => {
    const offset =
      l.headerStart +
      source.slice(l.headerStart, l.headerEnd).indexOf('>') +
      1;
    return parseAtoms(
      source.slice(offset, l.headerEnd).replace(/\r?\n$/, ''),
      offset,
    ).atoms;
  });
  for (const atom of [...ruleAtoms, ...guards]) {
    if (referenceName(atom) !== old) continue;
    const text =
      atom.name.toLowerCase() === 'condition'
        ? atom.raw.slice(0, atom.raw.indexOf('=') + 1) +
          (atom.value.startsWith('!') ? '!' : '') +
          newName
        : atom.raw.replace(atom.name, `action.${newName}`);
    edits.push({ start: atom.start, end: atom.end, text });
  }
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce(
      (next, edit) => patchCpl(next, edit.start, edit.end, edit.text),
      source,
    );
}
export function clonePolicyObject(
  source: string,
  definition: CplDefinition,
  newName: string,
) {
  if (
    !definition.complete ||
    !/^[A-Za-z_][\w.-]*$/.test(newName) ||
    indexPolicy(source).symbols.has(newName)
  )
    throw new Error('Choose a unique valid object name.');
  const newline = source
    .slice(definition.start, definition.end)
    .includes('\r\n')
    ? '\r\n'
    : '\n';
  return (
    source +
    (source.endsWith('\n') ? '' : newline) +
    newline +
    `define ${definition.kind} ${newName}${newline}` +
    source.slice(definition.bodyStart, definition.bodyEnd) +
    `end ${definition.kind} ${newName}${newline}`
  );
}
