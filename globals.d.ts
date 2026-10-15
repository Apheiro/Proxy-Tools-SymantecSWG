/** biome-ignore-all lint/style/useNamingConvention: <> */

declare interface Hostinfo {
  hostname: string;
  ip: string;
  dnsname: string;
  dnsip: string;
}

declare interface Proxy {
  pinglog: string;
  hostname: string;
  nslookup: string;
  active: boolean;
  last_check: string;
  hostinfo: Hostinfo;
  /** Original value entered by the user; retained after IP discovery. */
  registered_address?: string;
  /** Stable address used for future checks; promoted from hostname to IP after resolution. */
  primary_address?: string;
  /** User-defined inventory labels, independent of reachability results. */
  tags?: string[];
}

declare interface Credentials {
  username: string;
  password: string;
}

declare interface MatchedCondition {
  condition: string;
  matches: string[];
}

declare type AssignedVariables = Record<string, string>;

declare interface TransactionInfo {
  application: Application;
  connection: Connection;
  decision: Decision;
  policyMatches: PolicyMatch[];
  matchedConditions: MatchedCondition[];
  assignedVariables: AssignedVariables;
  timing: Timing;
  transaction: Transaction;
  user: User;
}

declare interface Application {
  group: string;
  name: string;
  operation: string;
}

declare interface Connection {
  client: string;
  clientInterface: string;
  destPort: number;
  proxyPort: number;
  routingDomain: string;
  sourcePort: number;
  time: string;
}

declare interface Decision {
  categories: string[];
  categoryGroups: string[];
  verdict: string;
}

declare interface PolicyMatch {
  header: string;
  matches: string[];
}

declare interface Timing {
  checkpoints: Checkpoints;
  clientFirstResponseByteMs: string;
  clientLastResponseByteMs: string;
  ocsConnectTimeMs: string;
  requestLatencyMs: string;
  responseLatencyFirstByteMs: string;
  serverConnectionConnectedMs: string;
  serverConnectionStartMs: string;
  serverDnsLookupStartMs: string;
  sslServerHelloCompleteMs: string;
  sslServerStartedTunnelMs: string;
  totalLatencyToFirstByteMs: string;
  totalTimeAddedMs: string;
  totalTransactionTimeMs: number;
  urlCategorizationCompleteMs: string;
}

declare interface Checkpoints {
  [name: string]: Checkpoint | null;
  'access-logging': Checkpoint | null;
  'client-in': Checkpoint | null;
  'client-out': Checkpoint | null;
  'new-connection': Checkpoint | null;
  'cache-hit': Checkpoint | null;
  'server-in': Checkpoint | null;
  'server-in-connection': Checkpoint | null;
  'server-out': Checkpoint | null;
  'stop-transaction': Checkpoint | null;
}

declare interface Checkpoint {
  elapsedMs: number;
  startMs: number;
}

declare interface Filters {
  start?: string;
  end?: string;
  status?: string[];
}

declare interface Transaction {
  method?: string;
  dest: string;
  from: string;
  id: string;
  pid: string;
  type: string;
}

declare interface User {
  authenticated: boolean;
  authorized: boolean;
  name: string;
  realm: string;
  relativeName: string;
}
