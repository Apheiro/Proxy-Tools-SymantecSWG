/** Lossless source ranges: visual edits patch only the selected construct. */
export type CplAtomKind = 'condition' | 'property' | 'action';
export interface CplAtom {
  start: number;
  end: number;
  raw: string;
  name: string;
  value: string;
  kind: CplAtomKind;
  operator?: '=' | '!=';
  form: 'equals' | 'call' | 'bare';
}
export interface CplRule {
  start: number;
  end: number;
  codeStart: number;
  codeEnd: number;
  line: number;
  raw: string;
  atoms: CplAtom[];
  comment: string;
  editable: boolean;
  disabled?: boolean;
}
export interface CplLayer {
  start: number;
  headerStart: number;
  end: number;
  headerEnd: number;
  line: number;
  type: string;
  label: string;
  guard: string;
  rules: CplRule[];
}
export interface CplDefinition {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  line: number;
  kind: string;
  name: string;
  complete: boolean;
}
export interface CplDocument {
  layers: CplLayer[];
  definitions: CplDefinition[];
  protected: {
    start: number;
    end: number;
    line: number;
    reason: string;
  }[];
}
interface Line {
  start: number;
  end: number;
  text: string;
  line: number;
}
function lines(source: string): Line[] {
  let start = 0;
  return source
    .split(/(?<=\n)/)
    .filter(Boolean)
    .map((text, index) => {
      const line = {
        start,
        end: start + text.length,
        text,
        line: index + 1,
      };
      start = line.end;
      return line;
    });
}
export function parseAtoms(
  code: string,
  offset = 0,
): {
  atoms: CplAtom[];
  comment: string;
  complete: boolean;
  balanced: boolean;
  codeEnd: number;
} {
  const atoms: CplAtom[] = [];
  let start = -1;
  let quote = '';
  let escaped = false;
  const stack: string[] = [];
  let commentAt = code.length;
  let complete = true;
  const flush = (end: number) => {
    if (start < 0) return;
    const raw = code.slice(start, end);
    const equals = /^([A-Za-z_][\w.-]*)(!?=)([\s\S]+)$/.exec(raw);
    const call = /^([A-Za-z_][\w.-]*)\s*\(([\s\S]*)\)$/.exec(raw);
    const bare = /^(allow|deny|force_deny)$/i.test(raw);
    if (equals)
      atoms.push({
        start: offset + start,
        end: offset + end,
        raw,
        name: equals[1],
        value: equals[3],
        operator: equals[2] as '=' | '!=',
        form: 'equals',
        kind: 'condition',
      });
    else if (call)
      atoms.push({
        start: offset + start,
        end: offset + end,
        raw,
        name: call[1],
        value: call[2],
        form: 'call',
        kind: call[1].startsWith('action.') ? 'action' : 'property',
      });
    else if (bare)
      atoms.push({
        start: offset + start,
        end: offset + end,
        raw,
        name: raw,
        value: '',
        form: 'bare',
        kind: 'property',
      });
    else complete = false;
    start = -1;
  };
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === ';') {
      flush(i);
      commentAt = i;
      if (stack.length) complete = false;
      break;
    }
    if (/\s/.test(c) && !stack.length) {
      if (
        start >= 0 &&
        /^[A-Za-z_][\w.-]*$/.test(code.slice(start, i)) &&
        /^\s*\(/.test(code.slice(i))
      )
        continue;
      flush(i);
      continue;
    }
    if (start < 0) start = i;
    if (c === '"' || c === "'") quote = c;
    else if ('([{'.includes(c)) stack.push(c);
    else if (
      ')]}'.includes(c) &&
      stack.pop() !== { ')': '(', ']': '[', '}': '{' }[c]
    )
      complete = false;
  }
  flush(commentAt);
  if (quote || stack.length) complete = false;
  return {
    atoms,
    comment: code.slice(commentAt),
    complete,
    balanced: !quote && stack.length === 0,
    codeEnd: commentAt,
  };
}
export function parseCpl(source: string): CplDocument {
  const result: CplDocument = {
    layers: [],
    definitions: [],
    protected: [],
  };
  const input = lines(source);
  let active: CplLayer | undefined;
  let bundleStart: number | null = null;
  for (let i = 0; i < input.length; i++) {
    const line = input[i];
    const text = line.text.trim();
    if (active && /^\s*; @proxytools-disabled: /.test(line.text)) {
      active.rules.push({
        start: bundleStart ?? line.start,
        end: line.end,
        codeStart: line.start,
        codeEnd: line.end,
        line: line.line,
        raw: line.text,
        atoms: [],
        comment: '',
        editable: false,
        disabled: true,
      });
      bundleStart = null;
      continue;
    }
    if (!text || text.startsWith(';')) {
      if (bundleStart === null) bundleStart = line.start;
      continue;
    }
    if (text.startsWith('#')) {
      const start = i;
      let depth = /^#if(?:n?def)?\b/i.test(text) ? 1 : 0;
      if (depth) {
        while (++i < input.length) {
          if (/^\s*#if(?:n?def)?\b/i.test(input[i].text)) depth++;
          if (/^\s*#endif\b/i.test(input[i].text) && --depth === 0)
            break;
        }
      }
      const end = input[Math.min(i, input.length - 1)].end;
      result.protected.push({
        start: input[start].start,
        end,
        line: line.line,
        reason: 'Preprocessor / conditional CPL — preserved in place',
      });
      bundleStart = null;
      continue;
    }
    const define =
      /^define\s+([\w.-]+)\s+("(?:\\.|[^"\\])*"|[\w.-]+)(?:\s*;.*)?$/i.exec(
        text,
      );
    if (define) {
      const first = line;
      let end = i + 1;
      while (
        end < input.length &&
        !/^\s*end(?:\s+[\w.-]+(?:\s+(?:"(?:\\.|[^"\\])*"|[\w.-]+))?)?\s*(?:;.*)?(?:\r?\n)?$/i.test(
          input[end].text,
        )
      )
        end++;
      const complete = end < input.length;
      const last = input[Math.min(end, input.length - 1)];
      result.definitions.push({
        start: first.start,
        end: last.end,
        bodyStart: first.end,
        bodyEnd: complete ? last.start : last.end,
        line: first.line,
        kind: define[1],
        name: define[2],
        complete,
      });
      if (!complete)
        result.protected.push({
          start: first.start,
          end: last.end,
          line: first.line,
          reason: 'Unterminated definition',
        });
      i = Math.min(end, input.length - 1);
      bundleStart = null;
      continue;
    }
    if (/^define\b/i.test(text)) {
      const first = line;
      let end = i + 1;
      while (
        end < input.length &&
        !/^\s*end(?:\s+[^;]+?)?\s*(?:;.*)?$/.test(
          input[end].text.trimEnd(),
        )
      )
        end++;
      const last = input[Math.min(end, input.length - 1)];
      result.protected.push({
        start: first.start,
        end: last.end,
        line: first.line,
        reason:
          'Definition header not represented by visual controls — full body preserved',
      });
      i = Math.min(end, input.length - 1);
      bundleStart = null;
      continue;
    }
    const header = /^\s*<([\w.-]+)([^>]*)>([^\r\n]*)(?:\r?\n)?$/.exec(
      line.text,
    );
    if (header) {
      if (active) active.end = bundleStart ?? line.start;
      const label = /^\s+([\w.-]+)\s*$/.exec(header[2]);
      active = {
        start: active ? (bundleStart ?? line.start) : line.start,
        headerStart: line.start,
        end: source.length,
        headerEnd: line.end,
        line: line.line,
        type: header[1],
        label: label?.[1] || '',
        guard: header[3].trim(),
        rules: [],
      };
      result.layers.push(active);
      bundleStart = null;
      continue;
    }
    if (!active) {
      result.protected.push({
        start: line.start,
        end: line.end,
        line: line.line,
        reason: 'Source outside a recognized layer — preserved',
      });
      bundleStart = null;
      continue;
    }
    let last = line;
    let code = line.text.replace(/\r?\n$/, '');
    let parsed = parseAtoms(code, line.start);
    // Continuations remain opaque, including their entire body, rather than becoming separate rules.
    if (!parsed.balanced || /\\\s*$/.test(code)) {
      while (
        i + 1 < input.length &&
        (!parsed.balanced || /\\\s*$/.test(code))
      ) {
        const next = input[i + 1];
        if (/^\s*(?:<|define\b|#)/i.test(next.text)) break;
        last = input[++i];
        code = source
          .slice(line.start, last.end)
          .replace(/\r?\n$/, '');
        parsed = parseAtoms(code, line.start);
        if (!/[('"[{\\]/.test(code)) break;
      }
    }
    const editable =
      last === line && parsed.complete && parsed.atoms.length > 0;
    active.rules.push({
      start: bundleStart ?? line.start,
      end: last.end,
      codeStart: line.start,
      codeEnd: line.start + parsed.codeEnd,
      raw: source.slice(line.start, last.end),
      line: line.line,
      atoms: parsed.atoms,
      comment: parsed.comment,
      editable,
    });
    bundleStart = null;
  }
  return result;
}
export function patchCpl(
  source: string,
  start: number,
  end: number,
  replacement: string,
) {
  if (start < 0 || end < start || end > source.length)
    throw new Error('Source changed; reopen this item.');
  return source.slice(0, start) + replacement + source.slice(end);
}
export function atomText(
  name: string,
  value: string,
  form: CplAtom['form'],
) {
  if (
    !/^[A-Za-z_][\w.-]*$/.test(name) ||
    /[\r\n]/.test(value) ||
    value.includes('\0')
  )
    throw new Error('Use a valid CPL name and single-line value.');
  const raw =
    form === 'bare'
      ? name
      : form === 'equals'
        ? `${name}=${value}`
        : `${name}(${value})`;
  const parsed = parseAtoms(raw);
  if (
    !parsed.complete ||
    parsed.comment ||
    parsed.atoms.length !== 1 ||
    parsed.atoms[0].raw !== raw
  )
    throw new Error(
      'The expression must be one balanced CPL condition, property or action.',
    );
  return raw;
}
export function appendAtom(
  source: string,
  rule: CplRule,
  atom: string,
) {
  const point = rule.atoms.at(-1)?.end ?? rule.codeStart;
  return patchCpl(source, point, point, ` ${atom}`);
}
export function removeAtom(
  source: string,
  rule: CplRule,
  atom: CplAtom,
) {
  if (rule.atoms.length === 1)
    throw new Error(
      'A rule needs at least one expression. Delete the rule instead.',
    );
  const next = rule.atoms.find((a) => a.start > atom.start);
  return next
    ? patchCpl(source, atom.start, next.start, '')
    : patchCpl(
        source,
        rule.atoms[rule.atoms.indexOf(atom) - 1].end,
        atom.end,
        '',
      );
}
export function moveRule(
  source: string,
  layer: CplLayer,
  rule: CplRule,
  direction: -1 | 1,
) {
  const index = layer.rules.indexOf(rule);
  const other = layer.rules[index + direction];
  if (!other || !other.editable || !rule.editable)
    throw new Error('Rules cannot cross a preserved source block.');
  const [first, second] =
    direction === -1 ? [other, rule] : [rule, other];
  if (first.end !== second.start)
    throw new Error(
      'Rules cannot cross a definition or preserved source block.',
    );
  const a = source.slice(first.start, first.end);
  const b = source.slice(second.start, second.end);
  if (!a.endsWith('\n') || !b.endsWith('\n'))
    throw new Error(
      'Add a final newline in source mode before reordering this rule.',
    );
  return patchCpl(source, first.start, second.end, b + a);
}
export function addLayer(
  source: string,
  type: string,
  label: string,
) {
  if (
    !/^[A-Za-z][\w.-]*$/.test(type) ||
    (!!label && !/^[A-Za-z_][\w.-]*$/.test(label))
  )
    throw new Error('Use a valid layer type and label.');
  return (
    source +
    (source && !source.endsWith('\n') ? '\n' : '') +
    `\n<${type}${label ? ` ${label}` : ''}>\n`
  );
}
export function addRule(
  source: string,
  layer: CplLayer,
  expression: string,
) {
  const parsed = parseAtoms(expression);
  if (
    !parsed.complete ||
    !parsed.atoms.length ||
    /[\r\n]/.test(expression)
  )
    throw new Error('Enter balanced CPL expressions for one rule.');
  const point = layer.rules.at(-1)?.end ?? layer.headerEnd;
  return patchCpl(
    source,
    point,
    point,
    `${source.slice(0, point).endsWith('\n') ? '' : '\n'}    ${expression}\n`,
  );
}
export function updateRule(
  source: string,
  rule: CplRule,
  expressions: string[],
  comment: string,
) {
  if (
    !rule.editable ||
    source.slice(rule.codeStart, rule.end) !== rule.raw
  )
    throw new Error('This rule is preserved or its source changed.');
  if (!expressions.length)
    throw new Error('Add at least one expression.');
  for (const expression of expressions) {
    const p = parseAtoms(expression);
    if (
      !p.complete ||
      p.comment ||
      p.atoms.length !== 1 ||
      /[\r\n]/.test(expression)
    )
      throw new Error('Invalid single CPL expression.');
  }
  if (/[\r\n]/.test(comment))
    throw new Error('Use a single-line rule comment.');
  if (
    expressions.length === rule.atoms.length &&
    expressions.every((a, i) => a === rule.atoms[i].raw) &&
    comment === rule.comment.replace(/^;\s?/, '')
  )
    return source;
  const prefix = source.slice(rule.codeStart, rule.atoms[0].start);
  let text = prefix;
  let old = -1;
  expressions.forEach((atom, index) => {
    const found = rule.atoms.findIndex(
      (a, i) => i > old && a.raw === atom,
    );
    if (index) {
      text +=
        found === old + 1 && old >= 0
          ? source.slice(rule.atoms[old].end, rule.atoms[found].start)
          : ' ';
    }
    text += atom;
    old = found;
  });
  const last = rule.atoms.at(-1)!;
  const originalComment = rule.comment.replace(/^;\s?/, '');
  if (comment === originalComment)
    text += source
      .slice(last.end, rule.end)
      .replace(/(?:\r?\n)$/, '');
  else if (comment) text += ` ; ${comment}`;
  const newline = rule.raw.endsWith('\r\n')
    ? '\r\n'
    : rule.raw.endsWith('\n')
      ? '\n'
      : '';
  return patchCpl(source, rule.codeStart, rule.end, text + newline);
}
export function updateLayer(
  source: string,
  layer: CplLayer,
  type: string,
  label: string,
  guard: string,
) {
  if (
    !/^[A-Za-z][\w.-]*$/.test(type) ||
    (!!label && !/^[A-Za-z_][\w.-]*$/.test(label)) ||
    /[\r\n]/.test(guard)
  )
    throw new Error('Invalid layer type, label or guard.');
  let header = source.slice(layer.headerStart, layer.headerEnd);
  const oldType = /<([\w.-]+)([^>]*)>/.exec(header)!;
  if (
    label !== layer.label &&
    oldType[2].trim() &&
    !/^\s+[\w.-]+\s*$/.test(oldType[2])
  )
    throw new Error(
      'This header has additional attributes; use source mode to change its identifier.',
    );
  const attributes =
    label === layer.label ? oldType[2] : label ? ` ${label}` : '';
  header = header.replace(
    /<([\w.-]+)([^>]*)>/,
    `<${type}${attributes}>`,
  );
  if (guard !== layer.guard) {
    const p = parseAtoms(guard);
    if (!p.complete)
      throw new Error('Preserved layer guard cannot be regenerated.');
    header =
      header.slice(0, header.indexOf('>') + 1) +
      (guard ? ` ${guard}` : '') +
      (header.endsWith('\r\n')
        ? '\r\n'
        : header.endsWith('\n')
          ? '\n'
          : '');
  }
  return patchCpl(source, layer.headerStart, layer.headerEnd, header);
}
export function definitionRows(
  source: string,
  definition: CplDefinition,
): CplRule[] {
  return lines(source.slice(definition.bodyStart, definition.bodyEnd))
    .filter((l) => l.text.trim() && !l.text.trim().startsWith(';'))
    .map((l) => {
      const start = definition.bodyStart + l.start;
      const parsed = parseAtoms(l.text.replace(/\r?\n$/, ''), start);
      return {
        start,
        end: definition.bodyStart + l.end,
        codeStart: start,
        codeEnd: start + parsed.codeEnd,
        raw: l.text,
        line: definition.line + l.line,
        atoms: parsed.atoms,
        comment: parsed.comment,
        editable: parsed.complete && !!parsed.atoms.length,
      };
    });
}
export function addDefinition(
  source: string,
  kind: string,
  name: string,
  rows: string[],
) {
  if (
    !/^[A-Za-z_][\w.-]*$/.test(name) ||
    !['condition', 'action'].includes(kind)
  )
    throw new Error('Use a valid condition/action object name.');
  if (
    parseCpl(source).definitions.some(
      (d) => d.name === name && d.kind === kind,
    )
  )
    throw new Error('An object with this name already exists.');
  if (!rows.length) throw new Error('Add at least one object row.');
  for (const row of rows) {
    const p = parseAtoms(row);
    if (
      !p.complete ||
      !p.atoms.length ||
      p.comment ||
      /[\r\n]/.test(row)
    )
      throw new Error(
        'Object rows must contain balanced CPL expressions.',
      );
    if (
      kind === 'condition' &&
      p.atoms.some((a) => a.kind !== 'condition')
    )
      throw new Error(
        'Condition objects can contain only conditions.',
      );
  }
  return (
    source +
    (source && !source.endsWith('\n') ? '\n' : '') +
    `\ndefine ${kind} ${name}\n${rows.map((r) => `    ${r}\n`).join('')}end\n`
  );
}
export function toggleRule(source: string, rule: CplRule) {
  if (rule.disabled)
    return patchCpl(
      source,
      rule.codeStart,
      rule.end,
      rule.raw.replace(/^(\s*); @proxytools-disabled: /, '$1'),
    );
  if (!rule.editable)
    throw new Error(
      'Preserved source cannot be disabled automatically.',
    );
  return patchCpl(
    source,
    rule.codeStart,
    rule.end,
    rule.raw.replace(/^(\s*)/, '$1; @proxytools-disabled: '),
  );
}
export function moveLayer(
  source: string,
  document: CplDocument,
  layer: CplLayer,
  direction: -1 | 1,
) {
  const other =
    document.layers[document.layers.indexOf(layer) + direction];
  if (!other) return source;
  const [first, second] =
    direction === -1 ? [other, layer] : [layer, other];
  if (
    document.definitions.some(
      (d) => d.start >= first.start && d.start < second.end,
    ) ||
    document.protected.some(
      (d) => d.start >= first.start && d.start < second.end,
    )
  )
    throw new Error(
      'Layers containing definitions or preserved directives must retain their source position.',
    );
  const a = source.slice(first.start, first.end),
    b = source.slice(second.start, second.end);
  if (!a.endsWith('\n') || !b.endsWith('\n'))
    throw new Error('Add a final newline before reordering layers.');
  return patchCpl(source, first.start, second.end, b + a);
}
