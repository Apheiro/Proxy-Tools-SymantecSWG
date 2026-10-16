import { ip, pipe, safeParse, string } from 'valibot';
import {
  atomText,
  type CplAtom,
  parseAtoms,
} from '@/lib/cplDocument';
export type PolicyColumn =
  | 'source'
  | 'destination'
  | 'service'
  | 'time'
  | 'action'
  | 'advanced';
export const POLICY_COLUMNS: { id: PolicyColumn; label: string }[] = [
  { id: 'source', label: 'Source' },
  { id: 'destination', label: 'Destination' },
  { id: 'service', label: 'Service' },
  { id: 'time', label: 'Time' },
  { id: 'action', label: 'Action' },
  { id: 'advanced', label: 'Combined / other' },
];
export interface PolicyCapability {
  name: string;
  label: string;
  column: PolicyColumn;
  form: CplAtom['form'];
  input: 'text' | 'ip' | 'port' | 'number' | 'choice';
  choices?: string[];
  quoted?: boolean;
  hint?: string;
}
const match = (
  name: string,
  label: string,
  column: PolicyColumn,
  input: PolicyCapability['input'] = 'text',
  quoted = false,
): PolicyCapability => ({
  name,
  label,
  column,
  form: 'equals',
  input,
  quoted,
});
const effect = (
  name: string,
  label: string,
  choices?: string[],
): PolicyCapability => ({
  name,
  label,
  column: 'action',
  form: 'call',
  input: choices ? 'choice' : 'text',
  choices,
});
const yesNo = ['yes', 'no'];
/** UI capabilities, not a replacement for the version-specific SGOS compiler. */
export const POLICY_CAPABILITIES: PolicyCapability[] = [
  match('client.address', 'Client IP / subnet', 'source', 'ip'),
  match(
    'client.effective_address',
    'Effective client IP',
    'source',
    'ip',
  ),
  match('client.host', 'Client hostname', 'source', 'text', true),
  match('user', 'Username', 'source', 'text', true),
  match(
    'user.regex',
    'Username regular expression',
    'source',
    'text',
    true,
  ),
  match('group', 'Directory group', 'source', 'text', true),
  match('realm', 'Authentication realm', 'source'),
  {
    ...match('authenticated', 'Authenticated user', 'source'),
    input: 'choice',
    choices: yesNo,
  },
  match(
    'client.connection.negotiated_ssl_version',
    'Client TLS version',
    'source',
  ),
  match('url.domain', 'Domain', 'destination'),
  match('url.host', 'Hostname', 'destination'),
  match(
    'url.host.exact',
    'Exact hostname',
    'destination',
    'text',
    true,
  ),
  match(
    'url.host.substring',
    'Hostname contains',
    'destination',
    'text',
    true,
  ),
  match(
    'url.address',
    'Destination IP / subnet',
    'destination',
    'ip',
  ),
  match('url', 'URL', 'destination', 'text', true),
  match('url.substring', 'URL contains', 'destination', 'text', true),
  match(
    'url.regex',
    'URL regular expression',
    'destination',
    'text',
    true,
  ),
  match(
    'url.path.prefix',
    'Path starts with',
    'destination',
    'text',
    true,
  ),
  match(
    'url.path.substring',
    'Path contains',
    'destination',
    'text',
    true,
  ),
  match(
    'url.query.substring',
    'Query contains',
    'destination',
    'text',
    true,
  ),
  match('category', 'Content categories (CPL list)', 'destination'),
  match('url.category', 'URL categories (CPL list)', 'destination'),
  match(
    'server.certificate.hostname.substring',
    'Certificate hostname contains',
    'destination',
    'text',
    true,
  ),
  match(
    'server.connection.negotiated_ssl_version',
    'Server TLS version',
    'destination',
  ),
  match(
    'request.header.Referer.url',
    'Referrer URL',
    'destination',
    'text',
    true,
  ),
  match(
    'request.header.Referer.url.category',
    'Referrer categories (CPL list)',
    'destination',
  ),
  match('http.method', 'HTTP method', 'service'),
  match('url.port', 'Destination port', 'service', 'port'),
  match('url.scheme', 'URL scheme', 'service'),
  match('request.application.name', 'Application', 'service'),
  match(
    'request.header.User-Agent',
    'User-Agent expression',
    'service',
    'text',
    true,
  ),
  match(
    'request.header.Referer',
    'Referrer expression',
    'service',
    'text',
    true,
  ),
  match('http.response.code', 'HTTP status', 'service', 'number'),
  match('weekday', 'Weekday (CPL value)', 'time'),
  match('date', 'Date (CPL value)', 'time'),
  match('time', 'Time range (CPL value)', 'time'),
  ...['allow', 'deny', 'force_deny'].map(
    (name): PolicyCapability => ({
      name,
      label:
        name === 'allow'
          ? 'Allow'
          : name === 'deny'
            ? 'Deny'
            : 'Force deny',
      column: 'action',
      form: 'bare',
      input: 'text',
    }),
  ),
  effect('authenticate', 'Authenticate / bypass (realm or no)'),
  effect('authenticate.force', 'Force authentication', yesNo),
  effect('authenticate.mode', 'Authentication mode', [
    'auto',
    'proxy',
    'proxy-ip',
    'origin',
    'origin-ip',
    'origin-cookie',
    'form-ip',
    'form-cookie',
  ]),
  effect('user.login.log_out', 'Log out user', ['true', 'false']),
  effect('detect_protocol', 'Protocol detection', ['none', 'no']),
  effect('detect_protocol.ssl', 'Detect TLS protocol', yesNo),
  effect('ssl.forward_proxy', 'TLS interception', ['no', 'https']),
  effect('ssl.forward_proxy.issuer_keyring', 'TLS issuer keyring'),
  effect('request.icap_service', 'Request ICAP service / no'),
  effect('response.icap_service', 'Response ICAP service / no'),
  effect('exception', 'Exception identifier'),
  effect('force_exception', 'Force exception identifier'),
  effect('cache', 'Cache response', yesNo),
  effect('bypass_cache', 'Bypass cache', yesNo),
  effect('access_server', 'Access destination server', yesNo),
  effect('forward', 'Forwarding host / group'),
  effect('forward.fail_open', 'Forward fail open', yesNo),
  effect('socks_gateway', 'SOCKS gateway / no'),
  effect('trace.request', 'Trace request', yesNo),
  effect('trace.rules', 'Trace rules', ['all', 'none']),
  effect('trace.destination', 'Trace output filename'),
  effect('access_log', 'Access log', yesNo),
];
export function capabilityFor(name: string) {
  return POLICY_CAPABILITIES.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
}
export function makeExpression(
  capability: PolicyCapability,
  value: string,
  negated = false,
) {
  let parameter = value.trim();
  if (capability.form !== 'bare' && !parameter)
    throw new Error('Enter a value.');
  if (
    capability.input === 'port' &&
    (!/^\d+$/.test(parameter) || +parameter < 1 || +parameter > 65535)
  )
    throw new Error('Port must be between 1 and 65535.');
  if (capability.input === 'number' && !/^\d+$/.test(parameter))
    throw new Error('Enter a whole number.');
  if (capability.input === 'ip') {
    const [address, subnet, ...extra] = parameter.split('/');
    if (
      extra.length ||
      !safeParse(pipe(string(), ip()), address).success
    )
      throw new Error(
        'Enter a valid IPv4 or IPv6 address. Use named conditions or advanced CPL for named subnet definitions and ranges.',
      );
    if (subnet !== undefined) {
      if (/^\d+$/.test(subnet)) {
        if (+subnet > (address.includes(':') ? 128 : 32))
          throw new Error('Invalid subnet prefix length.');
      } else if (
        !address.includes(':') &&
        safeParse(pipe(string(), ip()), subnet).success &&
        !subnet.includes(':')
      ) {
        const bits = subnet
          .split('.')
          .map((part) => Number(part).toString(2).padStart(8, '0'))
          .join('');
        if (!/^1*0*$/.test(bits))
          throw new Error('Subnet mask must have contiguous bits.');
      } else
        throw new Error('Enter a valid subnet prefix or IPv4 mask.');
    }
  }

  if (capability.quoted && parameter && !/^["']/.test(parameter)) {
    if (parameter.includes('"') && parameter.includes("'"))
      throw new Error(
        'Use advanced CPL for a value containing both quote types.',
      );
    const quote = parameter.includes('"') ? "'" : '"';
    parameter = quote + parameter + quote;
  }
  const expression = atomText(
    capability.name,
    parameter,
    capability.form,
  );
  if (negated && capability.form !== 'equals')
    throw new Error('Negation applies to match conditions only.');
  const next = negated ? expression.replace('=', '!=') : expression;
  if (!parseAtoms(next).complete)
    throw new Error('Invalid expression.');
  return next;
}
