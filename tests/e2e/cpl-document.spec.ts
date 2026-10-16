import { expect, test } from '@playwright/test';
import {
  addDefinition,
  addLayer,
  addRule,
  atomText,
  definitionRows,
  moveLayer,
  moveRule,
  parseAtoms,
  parseCpl,
  patchCpl,
  toggleRule,
  updateLayer,
  updateRule,
} from '../../src/lib/cplDocument';

test('lossless visual edits retain comments, spacing, unknown gestures and exact untouched ranges', () => {
  const source =
    '; file header\n<Proxy Existing> condition=!Skip ; guard\n  client.address=10.0.0.0/8   future.property("a; b", (x,y)) allow ; note\n; next rule\n url.domain=other.example deny\n\ndefine condition Skip\n  http.method=CONNECT\nend condition Skip\n';
  const doc = parseCpl(source);
  expect(doc.layers[0].label).toBe('Existing');
  expect(doc.definitions[0].complete).toBe(true);
  const rule = doc.layers[0].rules[0];
  expect(rule.editable).toBe(true);
  expect(rule.atoms.length).toBe(3);
  expect(
    updateRule(
      source,
      rule,
      rule.atoms.map((a) => a.raw),
      'note',
    ),
  ).toBe(source);
  const edited = updateRule(
    source,
    rule,
    [
      'client.address=192.0.2.0/24',
      ...rule.atoms.slice(1).map((a) => a.raw),
    ],
    'note',
  );
  expect(edited).toContain(
    'future.property("a; b", (x,y)) allow ; note',
  );
  expect(edited.slice(edited.indexOf('; next rule'))).toBe(
    source.slice(source.indexOf('; next rule')),
  );
});
test('definitions and conditional directives never become ordinary rules', () => {
  const source =
    '<Proxy>\nallow\n#if release.version=7.3\n<SSL>\nssl.forward_proxy(no)\n#endif\nweird_native_statement\nurl.domain=ok.example deny\ndefine action Foo\n rewrite(url,"a","b")\nend action Foo\n';
  const doc = parseCpl(source);
  expect(doc.layers.length).toBe(1);
  expect(doc.protected.length).toBe(1);
  expect(doc.layers[0].rules.map((r) => r.raw.trim())).toEqual([
    'allow',
    'weird_native_statement',
    'url.domain=ok.example deny',
  ]);
  expect(doc.layers[0].rules[1].editable).toBe(false);
  expect(doc.layers[0].rules[2].editable).toBe(true);
  expect(doc.definitions[0].name).toBe('Foo');
});
test('multiline and escaped expressions are protected without consuming following rules', () => {
  const source =
    '<Proxy>\nurl.domain=(\n "a.example",\n "b.example") allow\nurl.domain=c.example deny\n';
  const doc = parseCpl(source);
  expect(doc.layers[0].rules.length).toBe(2);
  expect(doc.layers[0].rules[0].editable).toBe(false);
  expect(doc.layers[0].rules[1].editable).toBe(true);
  expect(
    parseAtoms('url.regex="a\\";b" allow ; comment').atoms.length,
  ).toBe(2);
});
test('rule order, attached comments and disabled rules round-trip', () => {
  const source =
    '<Proxy>\n; A\nurl.domain=a.example allow\n; B\nurl.domain=b.example deny\n';
  const doc = parseCpl(source);
  const moved = moveRule(
    source,
    doc.layers[0],
    doc.layers[0].rules[1],
    -1,
  );
  expect(moved).toBe(
    '<Proxy>\n; B\nurl.domain=b.example deny\n; A\nurl.domain=a.example allow\n',
  );
  const disabled = toggleRule(source, doc.layers[0].rules[0]);
  const disabledRule = parseCpl(disabled).layers[0].rules[0];
  expect(disabledRule.disabled).toBe(true);
  expect(toggleRule(disabled, disabledRule)).toBe(source);
});
test('layer names use CPL syntax and guard/header edits preserve unrelated source', () => {
  let source = addLayer('', 'Proxy', 'WebAccess');
  expect(source).toContain('<Proxy WebAccess>');
  source = addRule(
    source,
    parseCpl(source).layers[0],
    'url.domain=example.com allow ; note',
  );
  const doc = parseCpl(source);
  expect(
    updateLayer(
      source,
      doc.layers[0],
      'Proxy',
      'Renamed',
      'condition=Skip',
    ),
  ).toContain('<Proxy Renamed> condition=Skip');
  expect(() => addLayer(source, 'Proxy', 'two words')).toThrow();
});
test('objects retain their location and prevent unsafe rule/layer moves across preserved ranges', () => {
  const source =
    '<Proxy A>\nallow\ndefine condition Clients\nclient.address=192.0.2.0/24\nend\ndeny\n<Proxy B>\nallow\n';
  const doc = parseCpl(source);
  expect(
    definitionRows(source, doc.definitions[0])[0].atoms[0].name,
  ).toBe('client.address');
  expect(() =>
    moveRule(source, doc.layers[0], doc.layers[0].rules[1], -1),
  ).toThrow();
  expect(() => moveLayer(source, doc, doc.layers[0], 1)).toThrow();
  expect(
    addDefinition(source, 'condition', 'Other', [
      'url.domain=a.example',
      'url.domain=b.example',
    ]),
  ).toContain(
    'define condition Other\n    url.domain=a.example\n    url.domain=b.example\nend',
  );
  expect(() =>
    addDefinition(source, 'condition', 'Clients', ['allow']),
  ).toThrow();
});
test('single-expression fields cannot inject rules, comments or inline CLI commands', () => {
  expect(() => atomText('url.domain', 'x\nEOF', 'equals')).toThrow();
  expect(() => atomText('url.domain', 'x deny', 'equals')).toThrow();
  expect(() =>
    atomText('url.domain', 'x ; comment', 'equals'),
  ).toThrow();
  expect(atomText('action.Example', 'yes', 'call')).toBe(
    'action.Example(yes)',
  );
  expect(() => patchCpl('a', -1, 0, '')).toThrow();
});

test('unknown definition headers preserve literal bodies and quoted named definitions remain objects', () => {
  const source =
    '<Proxy>\nallow\ndefine custom Header extra\n<SSL>\ninside literal body\nend custom Header\nurl.domain=after.example deny\ndefine condition "Office Clients"\nclient.address=192.0.2.0/24\nend condition "Office Clients"\n';
  const doc = parseCpl(source);
  expect(doc.layers).toHaveLength(1);
  expect(doc.protected).toHaveLength(1);
  expect(doc.protected[0].reason).toContain('Definition header');
  expect(doc.layers[0].rules).toHaveLength(2);
  expect(doc.definitions[0].name).toBe('"Office Clients"');
  expect(doc.definitions[0].complete).toBe(true);
});

// Semantic projection never splits compound relationships or replaces unknown CPL.
import {
  capabilityFor,
  makeExpression,
} from '../../src/lib/cplCapabilities';
import {
  indexPolicy,
  columnFor,
  replaceObjectRows,
  renamePolicyObject,
  clonePolicyObject,
} from '../../src/lib/cplSemantics';
import {
  encodeSharedPolicy,
  decodeSharedPolicy,
} from '../../src/lib/policySharedDocument';

test('common policy fields generate typed criteria and retain negation / spaced calls', () => {
  expect(
    makeExpression(capabilityFor('client.address')!, '192.0.2.0/24'),
  ).toBe('client.address=192.0.2.0/24');
  expect(
    makeExpression(capabilityFor('url.domain')!, 'example.com', true),
  ).toBe('url.domain!=example.com');
  expect(
    makeExpression(capabilityFor('group')!, 'EXAMPLE\\Proxy Users'),
  ).toBe('group="EXAMPLE\\Proxy Users"');
  expect(() =>
    makeExpression(capabilityFor('url.port')!, '70000'),
  ).toThrow();
  expect(() =>
    makeExpression(capabilityFor('url.domain')!, 'x\nEOF'),
  ).toThrow();
  const rule = parseCpl(
    '<Proxy>\nhttp.method=PUT authenticate (no) ALLOW\n',
  ).layers[0].rules[0];
  expect(rule.editable).toBe(true);
  expect(rule.atoms.map((a) => a.name)).toEqual([
    'http.method',
    'authenticate',
    'ALLOW',
  ]);
  expect(
    parseAtoms('url.domain!=example.com').atoms[0].operator,
  ).toBe('!=');
});

test('semantic columns follow named dependencies and keep mixed alternatives intact', () => {
  const source =
    '<Proxy>\ncondition=Mixed allow\ncondition=Clients deny\ndefine condition Mixed\nclient.address=192.0.2.1 url.domain=a.example\nclient.address=192.0.2.2 url.domain=b.example\nend\ndefine condition Clients\ncondition=IPs\nend\ndefine condition IPs\nclient.address=192.0.2.0/24\nend\n';
  const index = indexPolicy(source);
  expect(
    columnFor(index.document.layers[0].rules[0].atoms[0], index),
  ).toBe('advanced');
  expect(
    columnFor(index.document.layers[0].rules[1].atoms[0], index),
  ).toBe('source');
  expect(index.symbols.get('Mixed')!.rows.length).toBe(2);
  expect(index.symbols.get('IPs')!.uses).toHaveLength(1);
  expect(source).toContain(
    'client.address=192.0.2.1 url.domain=a.example',
  );
});

test('cyclic / external references remain compound and do not hang', () => {
  const index = indexPolicy(
    '<Proxy>\ncondition=A allow\ndefine condition A\ncondition=B\nend\ndefine condition B\ncondition=A\ncondition=External\nend\n',
  );
  expect(
    columnFor(index.document.layers[0].rules[0].atoms[0], index),
  ).toBe('advanced');
  expect(
    [...index.symbols.values()].flatMap((s) => s.issues).join(' '),
  ).toMatch(/Cyclic/);
  expect(
    [...index.symbols.values()].flatMap((s) => s.issues).join(' '),
  ).toMatch(/another policy source/);
});

test('bulk lists preserve comments, named terminators, CRLF and unrelated source', () => {
  const source =
    '<Proxy>\r\ncondition=Hosts allow\r\ndefine condition Hosts\r\n; ticket\r\n  url.domain=a.example ; first\r\n\turl.domain=b.example\r\nend condition Hosts\r\n; tail\r\n';
  const definition = parseCpl(source).definitions[0];
  expect(
    replaceObjectRows(source, definition, [
      'url.domain=a.example',
      'url.domain=b.example',
    ]),
  ).toBe(source);
  const result = replaceObjectRows(source, definition, [
    'url.domain=c.example',
    'url.domain=b.example',
    'url.domain=d.example',
  ]);
  expect(result).toContain(
    '; ticket\r\n  url.domain=c.example ; first\r\n\turl.domain=b.example\r\n    url.domain=d.example\r\nend condition Hosts',
  );
  expect(result.endsWith('; tail\r\n')).toBe(true);
  expect(() => replaceObjectRows(source, definition, [])).toThrow();
});

test('object renames update nested references and headers without changing literal destinations', () => {
  const source =
    '<Proxy> condition=!Hosts\ncondition!=Hosts url.domain=Hosts allow\ndefine condition Hosts\nurl.domain=example.com\nend condition Hosts\ndefine condition More\ncondition=Hosts\nend\n';
  const definition = parseCpl(source).definitions[0];
  const result = renamePolicyObject(source, definition, 'Renamed');
  expect(result).toContain('<Proxy> condition=!Renamed');
  expect(result).toContain(
    'condition!=Renamed url.domain=Hosts allow',
  );
  expect(result).toContain('define condition Renamed');
  expect(result).toContain('end condition Renamed');
  expect(result).toContain(
    'define condition More\ncondition=Renamed',
  );
  const clone = clonePolicyObject(source, definition, 'CopyHosts');
  expect(clone.startsWith(source)).toBe(true);
  expect(clone).toContain(
    'define condition CopyHosts\nurl.domain=example.com\nend condition CopyHosts',
  );
});

test('shared JSON is optional and round-trips the authoritative CPL exactly', () => {
  const text =
    '\uFEFF; header\r\n<Proxy>\r\nurl.domain=example.com allow\r\n';
  expect(decodeSharedPolicy(encodeSharedPolicy(text))).toBe(text);
  expect(() =>
    decodeSharedPolicy('{"format":"vpm","version":1,"cpl":"allow"}'),
  ).toThrow();
  expect(() =>
    decodeSharedPolicy(
      '{"format":"proxytools-policy","version":2,"cpl":"allow"}',
    ),
  ).toThrow();
});

test('typed IP inputs validate IPv4 IPv6 and subnet masks through the shared validation stack', () => {
  const cap = capabilityFor('url.address')!;
  expect(makeExpression(cap, '2001:db8::/32')).toBe(
    'url.address=2001:db8::/32',
  );
  expect(makeExpression(cap, '192.0.2.0/255.255.255.0')).toBe(
    'url.address=192.0.2.0/255.255.255.0',
  );
  for (const value of [
    '192.0.2.999',
    '192.0.2.0/33',
    '2001:db8::/129',
    '192.0.2.0/255.0.255.0',
    'not-an-ip',
  ])
    expect(() => makeExpression(cap, value)).toThrow();
});

test('renaming an object does not mistake a bare end condition for the object name', () => {
  const source =
    '<Proxy>\ncondition=Condition allow\ndefine condition Condition\nurl.domain=example.com\nend condition\n';
  const changed = renamePolicyObject(
    source,
    parseCpl(source).definitions[0],
    'Renamed',
  );
  expect(changed).toContain('end condition\n');
  expect(changed).not.toContain('end Renamed');
});
