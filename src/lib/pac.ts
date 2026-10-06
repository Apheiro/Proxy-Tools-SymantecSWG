export type PacStatus =
  | 'synced'
  | 'local-changes'
  | 'remote-changes'
  | 'conflict'
  | 'offline';
export type PacCondition = {
  kind:
    | 'domain'
    | 'url'
    | 'host'
    | 'starts-with'
    | 'ends-with'
    | 'contains'
    | 'ip-network'
    | 'expression'
    | 'regex'
    | 'always';
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
      protocol: 'PROXY' | 'HTTP' | 'HTTPS' | 'SOCKS' | 'SOCKS4' | 'SOCKS5';
    };
export type PacRule = {
  id: string;
  groupId?: string;
  condition: PacCondition;
  destination: PacDestination;
  fallbacks?: PacDestination[];
  editable: boolean;
  raw?: string;
  warning?: string;
};
export type PacGroup = {
  id: string;
  name: string;
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
  groups?: PacGroup[];
  baseGroups?: PacGroup[];
  entryPoint?: 'legacy' | 'ipv6';
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

export type ParsedIpNetwork = {
  family: 4 | 6;
  address: string;
  prefix: number;
};

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split('.');
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^\d{1,3}$/.test(part) || Number(part) < 0 || Number(part) > 255,
    )
  )
    return undefined;
  return parts.map(Number);
}

function ipv4ToString(parts: number[]): string {
  return parts.join('.');
}

function ipv4Mask(prefix: number): string {
  return ipv4ToString(
    Array.from({ length: 4 }, (_, index) => {
      const bits = Math.max(0, Math.min(8, prefix - index * 8));
      return bits === 0 ? 0 : 256 - 2 ** (8 - bits);
    }),
  );
}

export function parseIpNetwork(value: string): ParsedIpNetwork | undefined {
  const [rawAddress, rawPrefix, ...extra] = value.trim().split('/');
  if (!rawAddress || extra.length) return undefined;
  const ipv4 = parseIpv4(rawAddress);
  if (ipv4) {
    const prefix = rawPrefix === undefined ? 32 : Number(rawPrefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32)
      return undefined;
    const mask = parseIpv4(ipv4Mask(prefix))!;
    return {
      family: 4,
      address: ipv4ToString(ipv4.map((part, index) => part & mask[index])),
      prefix,
    };
  }
  const address = rawAddress.replace(/^\[|\]$/g, '');
  if (!address.includes(':')) return undefined;
  const prefix = rawPrefix === undefined ? 128 : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128)
    return undefined;
  try {
    new URL(`http://[${address}]/`);
  } catch {
    return undefined;
  }
  return { family: 6, address, prefix };
}

function prefixFromMask(mask: string): number | undefined {
  const parts = parseIpv4(mask);
  if (!parts) return undefined;
  const bits = parts.map((part) => part.toString(2).padStart(8, '0')).join('');
  if (!/^1*0*$/.test(bits)) return undefined;
  return bits.indexOf('0') < 0 ? 32 : bits.indexOf('0');
}

function parseIpv6(address: string): number[] | undefined {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (!value.includes(':') || (value.match(/::/g) ?? []).length > 1)
    return undefined;
  let expanded = value;
  const dotted = expanded.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = parseIpv4(dotted[1]);
    if (!v4) return undefined;
    const tail = [
      ((v4[0] << 8) | v4[1]).toString(16),
      ((v4[2] << 8) | v4[3]).toString(16),
    ];
    expanded = expanded.slice(0, -dotted[1].length) + tail.join(':');
  }
  const halves = expanded.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  )
    return undefined;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (
    words.length !== 8 ||
    words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))
  )
    return undefined;
  return words.flatMap((word) => {
    const number = Number.parseInt(word, 16);
    return [number >> 8, number & 255];
  });
}

export function ipMatchesNetwork(
  address: string,
  network: ParsedIpNetwork,
): boolean {
  if (network.family === 4) {
    const candidate = parseIpv4(address);
    const base = parseIpv4(network.address);
    if (!candidate || !base) return false;
    const mask = parseIpv4(ipv4Mask(network.prefix))!;
    return candidate.every(
      (part, index) => (part & mask[index]) === base[index],
    );
  }
  const candidate = parseIpv6(address),
    base = parseIpv6(network.address);
  if (!candidate || !base) return false;
  for (let index = 0; index < network.prefix; index += 1) {
    const byte = Math.floor(index / 8),
      bit = 7 - (index % 8),
      mask = 1 << bit;
    if ((candidate[byte] & mask) !== (base[byte] & mask)) return false;
  }
  return true;
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
    /^\s*(url|host)\.indexOf\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*===?\s*0\s*$/,
  );
  if (m)
    return {
      kind: 'starts-with',
      target: m[1] as 'url' | 'host',
      value: unquote(m[2]) ?? '',
    };
  m = expression.match(
    /^\s*(url|host)\.indexOf\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*!==?\s*-1\s*$/,
  );
  if (m)
    return {
      kind: 'contains',
      target: m[1] as 'url' | 'host',
      value: unquote(m[2]) ?? '',
    };
  m = expression.match(
    /^\s*(url|host)\.lastIndexOf\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*===?\s*\1\.length\s*-\s*\2\.length\s*$/,
  );
  if (m)
    return {
      kind: 'ends-with',
      target: m[1] as 'url' | 'host',
      value: unquote(m[2]) ?? '',
    };
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
    /^\s*isInNet\(\s*host\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*$/i,
  );
  if (m) {
    const prefix = prefixFromMask(unquote(m[2]) ?? '');
    const network =
      prefix === undefined
        ? undefined
        : parseIpNetwork(`${unquote(m[1])}/${prefix}`);
    if (network?.family === 4)
      return {
        kind: 'ip-network',
        value: `${network.address}/${network.prefix}`,
      };
  }
  m = expression.match(
    /^\s*isInNetEx\(\s*host\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*$/i,
  );
  if (m) {
    const network = parseIpNetwork(unquote(m[1]) ?? '');
    if (network?.family === 6)
      return {
        kind: 'ip-network',
        value: `${network.address}/${network.prefix}`,
      };
  }
  m = expression.match(
    /^\s*dnsDomainIs\(\s*host\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)\s*$/,
  );
  if (m)
    return {
      kind: 'domain',
      value: (unquote(m[1]) ?? '').replace(/^\./, ''),
    };
  const rawExpression = expression.trim();
  if (rawExpression && !/[;{}]/.test(rawExpression))
    return { kind: 'expression', value: rawExpression };
  return undefined;
}

function parseReturn(
  value: string,
  proxies: Proxy[],
): PacDestination[] | undefined {
  const destinations: PacDestination[] = [];
  for (const entry of value.split(';').map((part) => part.trim()).filter(Boolean)) {
    const parsed = parseDestination(entry, proxies);
    if (!parsed) return undefined;
    destinations.push(parsed);
  }
  return destinations.length ? destinations : undefined;
}

function parseDestination(
  value: string,
  proxies: Proxy[],
): PacDestination | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1 && parts[0].toUpperCase() === 'DIRECT')
    return { kind: 'direct' };
  if (
    parts.length !== 2 ||
    !['PROXY', 'HTTP', 'HTTPS', 'SOCKS', 'SOCKS4', 'SOCKS5'].includes(
      parts[0].toUpperCase(),
    )
  )
    return undefined;
  const colon = parts[1].lastIndexOf(':');
  if (colon < 1 || !/^\d+$/.test(parts[1].slice(colon + 1)))
    return undefined;
  const host = parts[1].slice(0, colon),
    port = parts[1].slice(colon + 1);
  if (Number(port) < 1 || Number(port) > 65535) return undefined;
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
      | 'HTTP'
      | 'HTTPS'
      | 'SOCKS'
      | 'SOCKS4'
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
  entryPoint: 'legacy' | 'ipv6';
  error?: string;
} {
  const fn =
    /function\s+(FindProxyForURLEx|FindProxyForURL)\s*\(\s*url\s*,\s*host\s*\)\s*\{/i.exec(
      content,
    );
  if (!fn)
    return {
      rules: [],
      prefix: '',
      suffix: '',
      entryPoint: 'legacy',
      error: 'Could not find a FindProxyForURL(url, host) function.',
    };
  const open = fn.index + fn[0].lastIndexOf('{'),
    close = findBrace(content, open);
  if (close < 0)
    return {
      rules: [],
      prefix: '',
      suffix: '',
      entryPoint: fn[1].toLowerCase().endsWith('ex') ? 'ipv6' : 'legacy',
      error: 'The FindProxyForURL function has unbalanced braces.',
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
          error = 'An unterminated comment was found in FindProxyForURL.';
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
        error = 'A PAC condition has unbalanced parentheses.';
        break;
      }
      let brace = parenClose + 1;
      while (/\s/.test(body[brace] ?? '')) brace += 1;
      if (body[brace] !== '{') {
        error = 'Only if rules with a braced block are supported.';
        break;
      }
      const blockClose = findBrace(body, brace);
      if (blockClose < 0) {
        error = 'A PAC rule has unbalanced braces.';
        break;
      }
      const ret =
        /^\s*return\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*;?\s*$/.exec(
          body.slice(brace + 1, blockClose),
        );
      const condition = parseCondition(
        body.slice(parenOpen + 1, parenClose),
      );
      const destinations = ret
        ? parseReturn(unquote(ret[1]) ?? '', proxies)
        : undefined;
      if (!condition || !destinations) {
        error =
          'A rule uses a condition or destination outside the visual editor format. The original PAC is preserved and editing is disabled to avoid losing logic.';
        break;
      }
      rules.push({
        id: crypto.randomUUID(),
        groupId: 'general',
        condition,
        destination: destinations[0],
        fallbacks: destinations.slice(1),
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
      const destinations = parseReturn(
        unquote(fallback[1]) ?? '',
        proxies,
      );
      if (!destinations) {
        error =
          'The final destination is neither DIRECT nor a registered proxy. The original PAC is preserved.';
        break;
      }
      rules.push({
        id: crypto.randomUUID(),
        groupId: 'general',
        condition: { kind: 'always', value: '' },
        destination: destinations[0],
        fallbacks: destinations.slice(1),
        editable: true,
      });
      i += fallback[0].length;
      skip();
      if (i < body.length)
        error =
          'Code appears after the final return. The original PAC is preserved.';
      break;
    }
    error =
      'The function contains PAC code the visual editor cannot interpret. The original is preserved and editing is disabled to avoid losing logic.';
  }
  return {
    rules,
    prefix: content.slice(0, open + 1),
    suffix: content.slice(close),
    entryPoint: fn[1].toLowerCase().endsWith('ex') ? 'ipv6' : 'legacy',
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
  const needsIpv6 = rules.some(
    (rule) =>
      (rule.condition.kind === 'ip-network' &&
        parseIpNetwork(rule.condition.value)?.family === 6) ||
      (rule.condition.kind === 'expression' &&
        /\b(?:isInNetEx|dnsResolveEx|myIpAddressEx|isResolvableEx|sortIpAddressList)\s*\(/i.test(rule.condition.value)),
  );
  const entryPoint =
    needsIpv6 || source.entryPoint === 'ipv6'
      ? 'FindProxyForURLEx'
      : 'FindProxyForURL';
  const statements: string[] = [];
  let lastGroup = '';
  for (const rule of rules) {
    const group = source.groups?.find(
      (item) => item.id === rule.groupId,
    );
    if (group && group.id !== lastGroup) {
      statements.push(`  // ${group.name.replace(/[\r\n]+/g, ' ')}`);
      lastGroup = group.id;
    }
    statements.push(
      `  if (${conditionCode(rule.condition)}) {\n    return ${JSON.stringify([rule.destination, ...(rule.fallbacks ?? [])].map(destinationCode).join('; '))};\n  }`,
    );
  }
  if (fallback)
    statements.push(
      `  return ${JSON.stringify([fallback.destination, ...(fallback.fallbacks ?? [])].map(destinationCode).join('; '))};`,
    );
  const prefix = source.prefix
    ? source.prefix.replace(
        /function\s+FindProxyForURLEx?\s*\(/i,
        `function ${entryPoint}(`,
      )
    : `function ${entryPoint}(url, host) {`;
  return `${prefix}\n${statements.join('\n')}\n${source.suffix ?? '}'}\n`;
}

function conditionCode(condition: PacCondition): string {
  if (condition.kind === 'domain')
    return `dnsDomainIs(host, ${JSON.stringify(`.${condition.value.replace(/^\./, '')}`)}) || host === ${JSON.stringify(condition.value.replace(/^\./, ''))}`;
  if (condition.kind === 'url')
    return `shExpMatch(url, ${JSON.stringify(condition.value)})`;
  if (condition.kind === 'host')
    return `host === ${JSON.stringify(condition.value)}`;
  if (condition.kind === 'starts-with')
    return `${condition.target ?? 'url'}.indexOf(${JSON.stringify(condition.value)}) === 0`;
  if (condition.kind === 'ends-with') {
    const target = condition.target ?? 'url';
    return `${target}.lastIndexOf(${JSON.stringify(condition.value)}) === ${target}.length - ${JSON.stringify(condition.value)}.length`;
  }
  if (condition.kind === 'contains')
    return `${condition.target ?? 'url'}.indexOf(${JSON.stringify(condition.value)}) !== -1`;
  if (condition.kind === 'ip-network') {
    const network = parseIpNetwork(condition.value);
    if (!network) return 'false';
    if (network.family === 6)
      return `isInNetEx(host, ${JSON.stringify(`${network.address}/${network.prefix}`)})`;
    return `isInNet(host, ${JSON.stringify(network.address)}, ${JSON.stringify(ipv4Mask(network.prefix))})`;
  }
  if (condition.kind === 'expression') return condition.value;
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
  if (
    condition.kind === 'starts-with' ||
    condition.kind === 'ends-with' ||
    condition.kind === 'contains'
  ) {
    const target =
      condition.target === 'host' ? hostValue : urlValue;
    if (condition.kind === 'starts-with')
      return target.startsWith(condition.value);
    if (condition.kind === 'ends-with')
      return target.endsWith(condition.value);
    return target.includes(condition.value);
  }
  if (condition.kind === 'ip-network') {
    const network = parseIpNetwork(condition.value);
    return network ? ipMatchesNetwork(hostValue, network) : false;
  }
  if (condition.kind === 'expression') return false;
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
