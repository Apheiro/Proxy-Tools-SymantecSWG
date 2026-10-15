export function traceLog(
  id: string,
  options: {
    type?: string;
    parent?: string;
    verdict?: string;
    time?: string;
    method?: string;
    checkpoints?: Record<string, Checkpoint>;
    matches?: string[];
    dest?: string;
  } = {},
): TransactionInfo {
  return {
    transaction: {
      id,
      pid: options.parent ?? null,
      from: options.parent ?? null,
      type: options.type ?? 'http.proxy',
      method: options.method ?? 'CONNECT',
      dest: options.dest ?? 'tcp://example.test:443/',
    },
    connection: {
      client: '192.0.2.10',
      clientInterface: '0:0',
      destPort: 443,
      proxyPort: 8080,
      sourcePort: 54321,
      routingDomain: 'default',
      time:
        options.time === undefined
          ? '2026-08-02 15:51:32 UTC'
          : options.time,
    },
    decision: {
      verdict:
        options.verdict === undefined
          ? 'ALLOWED (handed off)'
          : options.verdict,
      categories: ['Technology'],
      categoryGroups: [],
    },
    application: {
      name: 'Example application',
      group: 'Web',
      operation: '',
    },
    user: {
      name: null,
      relativeName: null,
      realm: null,
      authenticated: false,
      authorized: false,
    },
    policyMatches: [
      {
        header: '<Proxy> [layer 1]',
        matches: options.matches ?? [
          'miss: category=deny DENY',
          'n/a: ALLOW',
          'late: EXCEPTION(authentication_failed)',
        ],
      },
    ],
    matchedConditions: [],
    assignedVariables: {},
    timing: {
      checkpoints: options.checkpoints ?? {
        'new-connection': { startMs: 0, elapsedMs: 0 },
        'client-in': { startMs: 0, elapsedMs: 0 },
        'stop-transaction': { startMs: 2, elapsedMs: 0 },
      },
      totalTransactionTimeMs: 2,
    } as Timing,
  };
}

export function traceScenario() {
  return [
    traceLog('123', { time: '2026-08-02 15:51:31 UTC' }),
    traceLog('1234', {
      type: 'ssl.tunnel',
      parent: '123',
      verdict: 'ALLOW (intercept https)',
    }),
    traceLog('1235', {
      type: 'https.forward-proxy',
      parent: '1234',
      verdict: 'ALLOWED',
      method: 'HEAD',
      dest: 'https://example.test/resource',
      time: '2026-08-02 15:51:33 UTC',
    }),
    traceLog('900', {
      type: 'tcp.tunnel',
      parent: '899',
      verdict: null,
      time: null,
      method: 'TUNNEL',
    }),
    traceLog('901', {
      verdict: 'EXCEPTION(tcp_error): Could not connect',
      time: 'bad timestamp',
    }),
  ];
}
