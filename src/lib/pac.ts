export type PacStatus =
  | 'synced'
  | 'local-changes'
  | 'remote-changes'
  | 'conflict'
  | 'offline';
export type PacCondition = {
  kind: 'domain' | 'url' | 'host' | 'regex' | 'always';
  value: string;
  target?: 'url' | 'host';
};
export type PacDestination =
  | { kind: 'direct' }
  | {
      kind: 'proxy';
      proxyRef: string;
      host: string;
      port: string;
      protocol: 'PROXY' | 'HTTPS' | 'SOCKS' | 'SOCKS5';
    };
export type PacRule = {
  id: string;
  condition: PacCondition;
  destination: PacDestination;
  editable: boolean;
  raw?: string;
  warning?: string;
};
export type PacSource = {
  id: string;
  name: string;
  url: string;
  resolvedUrl?: string;
  remoteEtag?: string;
  remoteLastModified?: string;
  baseHash?: string;
  rules: PacRule[];
  baseRules: PacRule[];
  prefix?: string;
  suffix?: string;
  remoteContent?: string;
  lastSyncedAt?: string;
  status: PacStatus;
  pendingContent?: string;
  pendingHash?: string;
  parseError?: string;
};
export type PacFetch = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  etag?: string;
  lastModified?: string;
  content: string;
};

export function proxyIdentity(proxy: Proxy): string {
  return (
    proxy.primary_address ||
    proxy.hostinfo?.ip ||
    proxy.registered_address ||
    proxy.hostname
  );
}

function findBrace(source: string, open: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i],
      n = source[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function matchingParen(source: string, open: number): number {
  let depth = 0,
    quote = '',
    escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function unquote(text: string): string | undefined {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('"')) return JSON.parse(trimmed);
    if (trimmed.startsWith("'"))
      return JSON.parse(
        `"${trimmed.slice(1, -1).replaceAll('"', '\\"')}"`,
      );
  } catch {
    return undefined;
  }
  return undefined;
}

function parseCondition(
  expression: string,
): PacCondition | undefined {
  let m = expression.match(
    /^\s*dnsDomainIs\(\s*host\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*\|\|\s*host\s*===?\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*$/,
  );
  if (m) {
    const domain = (unquote(m[1]) ?? '').replace(/^\./, '');
    if (
      domain.toLowerCase() === (unquote(m[2]) ?? '').toLowerCase()
    ) {
      return { kind: 'domain', value: domain };
    }
  }
  m = expression.match(
    /^\s*host\s*===?\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*$/,
  );
  if (m) return { kind: 'host', value: unquote(m[1]) ?? '' };
  m = expression.match(
    /^\s*shExpMatch\(\s*url\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*$/,
  );
  if (m) return { kind: 'url', value: unquote(m[1]) ?? '' };
  m = expression.match(
    /^\s*(?:host|url)\s*\.match\(\s*\/(.*)\/([gimsuy]*)\s*\)\s*$/,
  );
  if (m)
    return {
      kind: 'regex',
      value: m[1],
      target: expression.trimStart().startsWith('host')
        ? 'host'
        : 'url',
    };
  m = expression.match(
    /^\s*new\s+RegExp\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\.test\(\s*(url|host)\s*\)\s*$/,
  );
  if (m)
    return {
      kind: 'regex',
      value: unquote(m[1]) ?? '',
      target: m[2] as 'url' | 'host',
    };
  m = expression.match(
    /^\s*dnsDomainIs\(\s*host\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*$/,
  );
  if (m)
    return {
      kind: 'domain',
      value: (unquote(m[1]) ?? '').replace(/^\./, ''),
    };
  return undefined;
}

function parseReturn(
  value: string,
  proxies: Proxy[],
): PacDestination | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1 && parts[0].toUpperCase() === 'DIRECT')
    return { kind: 'direct' };
  if (
    parts.length !== 2 ||
    !['PROXY', 'HTTPS', 'SOCKS', 'SOCKS5'].includes(
      parts[0].toUpperCase(),
    )
  )
    return undefined;
  const colon = parts[1].lastIndexOf(':');
  if (colon < 1 || !/^\d+$/.test(parts[1].slice(colon + 1)))
    return undefined;
  const host = parts[1].slice(0, colon),
    port = parts[1].slice(colon + 1);
  const normalizedHost = host.replace(/^\[|\]$/g, '').toLowerCase();
  const proxy = proxies.find((item) =>
    [
      item.primary_address,
      item.registered_address,
      item.hostname,
      item.hostinfo?.ip,
    ].some(
      (x) =>
        x?.replace(/^\[|\]$/g, '').toLowerCase() === normalizedHost,
    ),
  );
  if (!proxy) return undefined;
  return {
    kind: 'proxy',
    proxyRef: proxyIdentity(proxy),
    host,
    port,
    protocol: parts[0].toUpperCase() as
      | 'PROXY'
      | 'HTTPS'
      | 'SOCKS'
      | 'SOCKS5',
  };
}

export function parsePac(
  content: string,
  proxies: Proxy[],
): {
  rules: PacRule[];
  prefix: string;
  suffix: string;
  error?: string;
} {
  const fn =
    /function\s+FindProxyForURL\s*\(\s*url\s*,\s*host\s*\)\s*\{/i.exec(
      content,
    );
  if (!fn)
    return {
      rules: [],
      prefix: '',
      suffix: '',
      error: 'No se encontró una función FindProxyForURL(url, host).',
    };
  const open = fn.index + fn[0].lastIndexOf('{'),
    close = findBrace(content, open);
  if (close < 0)
    return {
      rules: [],
      prefix: '',
      suffix: '',
      error: 'La función FindProxyForURL tiene llaves incompletas.',
    };
  const body = content.slice(open + 1, close),
    rules: PacRule[] = [];
  let i = 0,
    error: string | undefined;
  const skip = () => {
    while (i < body.length) {
      if (/\s/.test(body[i])) {
        i += 1;
        continue;
      }
      if (body.startsWith('//', i)) {
        const end = body.indexOf('\n', i + 2);
        i = end < 0 ? body.length : end + 1;
        continue;
      }
      if (body.startsWith('/*', i)) {
        const end = body.indexOf('*/', i + 2);
        if (end < 0) {
          error = 'Comentario sin cierre dentro de FindProxyForURL.';
          i = body.length;
        } else i = end + 2;
        continue;
      }
      break;
    }
  };
  while (i < body.length && !error) {
    skip();
    if (i >= body.length) break;
    const tail = body.slice(i);
    if (/^if\s*\(/.test(tail)) {
      const parenOpen = body.indexOf('(', i),
        parenClose = matchingParen(body, parenOpen);
      if (parenClose < 0) {
        error = 'Condición PAC con paréntesis incompletos.';
        break;
      }
      let brace = parenClose + 1;
      while (/\s/.test(body[brace] ?? '')) brace += 1;
      if (body[brace] !== '{') {
        error = 'Solo se admiten reglas if con bloque entre llaves.';
        break;
      }
      const blockClose = findBrace(body, brace);
      if (blockClose < 0) {
        error = 'Regla PAC con llaves incompletas.';
        break;
      }
      const ret =
        /^\s*return\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*;?\s*$/.exec(
          body.slice(brace + 1, blockClose),
        );
      const condition = parseCondition(
        body.slice(parenOpen + 1, parenClose),
      );
      const destination = ret
        ? parseReturn(unquote(ret[1]) ?? '', proxies)
        : undefined;
      if (!condition || !destination) {
        error =
          'Hay una regla con condición o destino fuera del formato visual compatible; se conserva el PAC original sin permitir una edición que pueda perder lógica.';
        break;
      }
      rules.push({
        id: crypto.randomUUID(),
        condition,
        destination,
        editable: true,
      });
      i = blockClose + 1;
      continue;
    }
    const fallback =
      /^return\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*;?/.exec(
        tail,
      );
    if (fallback) {
      const destination = parseReturn(
        unquote(fallback[1]) ?? '',
        proxies,
      );
      if (!destination) {
        error =
          'El destino final no es DIRECT ni un proxy registrado; se conserva el PAC original.';
        break;
      }
      rules.push({
        id: crypto.randomUUID(),
        condition: { kind: 'always', value: '' },
        destination,
        editable: true,
      });
      i += fallback[0].length;
      skip();
      if (i < body.length)
        error =
          'Hay código después del return final; se conserva el PAC original.';
      break;
    }
    error =
      'La función contiene código PAC que el editor visual no interpreta; se conserva el original y se desactiva la edición para evitar perder lógica.';
  }
  return {
    rules,
    prefix: content.slice(0, open + 1),
    suffix: content.slice(close),
    error,
  };
}

export function generatePac(source: PacSource): string {
  const rules = source.rules.filter(
    (rule) => rule.condition.kind !== 'always',
  );
  const fallback = source.rules.find(
    (rule) => rule.condition.kind === 'always',
  );
  const statements = rules.map(
    (rule) =>
      `  if (${conditionCode(rule.condition)}) {\n    return ${JSON.stringify(destinationCode(rule.destination))};\n  }`,
  );
  if (fallback)
    statements.push(
      `  return ${JSON.stringify(destinationCode(fallback.destination))};`,
    );
  return `${source.prefix ?? 'function FindProxyForURL(url, host) {'}\n${statements.join('\n')}\n${source.suffix ?? '}'}\n`;
}

function conditionCode(condition: PacCondition): string {
  if (condition.kind === 'domain')
    return `dnsDomainIs(host, ${JSON.stringify(`.${condition.value.replace(/^\./, '')}`)}) || host === ${JSON.stringify(condition.value.replace(/^\./, ''))}`;
  if (condition.kind === 'url')
    return `shExpMatch(url, ${JSON.stringify(condition.value)})`;
  if (condition.kind === 'host')
    return `host === ${JSON.stringify(condition.value)}`;
  if (condition.kind === 'regex')
    return `new RegExp(${JSON.stringify(condition.value)}).test(${condition.target ?? 'url'})`;
  return 'true';
}

function destinationCode(destination: PacDestination): string {
  if (destination.kind === 'direct') return 'DIRECT';
  const host =
    destination.host.includes(':') &&
    !destination.host.startsWith('[')
      ? `[${destination.host}]`
      : destination.host;
  return `${destination.protocol} ${host}:${destination.port}`;
}

export function rulesEqual(a: PacRule[], b: PacRule[]): boolean {
  const normalize = (rules: PacRule[]) =>
    rules.map(({ id: _id, ...rule }) => rule);
  return (
    JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
  );
}

export function urlMatches(
  urlValue: string,
  hostValue: string,
  condition: PacCondition,
): boolean {
  const host = hostValue.toLowerCase();
  if (condition.kind === 'always') return true;
  if (condition.kind === 'host')
    return host === condition.value.toLowerCase();
  if (condition.kind === 'domain') {
    const d = condition.value.replace(/^\./, '').toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  }
  if (condition.kind === 'url') {
    const escaped = [...condition.value]
      .map((character) => {
        if (character === '*') return '.*';
        if (character === '?') return '.';
        return /[.+^${}()|[\]\\]/.test(character)
          ? `\\${character}`
          : character;
      })
      .join('');
    return new RegExp(`^${escaped}$`).test(urlValue);
  }
  if (condition.kind === 'regex') {
    try {
      return new RegExp(condition.value).test(
        condition.target === 'host' ? hostValue : urlValue,
      );
    } catch {
      return false;
    }
  }
  return false;
}
