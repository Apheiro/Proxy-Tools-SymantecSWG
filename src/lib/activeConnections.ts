import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export type ActiveScope = { proxy: string; profile: 'live' | 'mock' };
export type ConnectionSnapshot = {
  id: number;
  received_at: number;
  device_time: string | null;
  endpoint: string;
  sessions: number | null;
  connections: number | null;
  clients: number | null;
  parsed_sessions: number | null;
  parsed_connections: number | null;
  duration_ms: number;
  response_bytes: number;
  quality: string;
  warnings: string[];
  clock_skew_ms: number | null;
  content_hash: string | null;
};
export type MonitorStatus = {
  id: string;
  state: string;
  interval: number;
  route: string;
  last: ConnectionSnapshot | null;
  last_good: ConnectionSnapshot | null;
  error: string | null;
  polls: number;
  failures: number;
};
export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
};
export type ConnectionRow = {
  id: string;
  parent: string;
  ambiguous: boolean;
  session: number;
  ordinal: number;
  client: string | null;
  server: string | null;
  application: string | null;
  protocol: string | null;
  kind: string | null;
  client_active: string | null;
  server_active: string | null;
  duration: number | null;
  error: string | null;
};
export type RankingRow = {
  name: string | null;
  observed_members: number;
  active_client_legs: number;
  primary_members: number;
};
export type CaptureEntry = {
  id: string;
  started: number;
  ended: number | null;
  interval: number;
  route: string | null;
};
export type QueryResult<T> = {
  items: T[];
  total: number;
  snapshot?: number;
};
export type ConnectionDetail = {
  raw: XmlNode;
  parent: string;
  first_observed_sample: number;
  last_observed_sample: number;
  first_observed_at: number;
  last_observed_at: number;
  ambiguous: boolean;
};
export type MonitorQuery = {
  kind: string;
  snapshot?: number;
  offset?: number;
  limit?: number;
  search?: string;
  sort?: string;
  after?: number;
  before?: number;
  connection?: string;
  filter?: string;
};
/** Bound IPC pages; invalidate late results and interrupt SQLite when a view changes. */
export function useActiveQuery<T>(
  scope: ActiveScope,
  id: string,
  query: MonitorQuery,
) {
  const [result, setResult] = useState<{ key: string; value: T } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const encoded = JSON.stringify(query);
  const requestKey = JSON.stringify([scope.proxy, scope.profile, id, encoded]);
  const data = result?.key === requestKey ? result.value : null;
  useEffect(() => {
    setResult(null);
    setError('');
    if (!id) {
      setBusy(false);
      return;
    }
    let current = true;
    const requestId = crypto.randomUUID();
    setBusy(true);
    void invoke<T>('ac_query', {
      scope,
      id,
      requestId,
      query: JSON.parse(encoded),
    })
      .then((value) => {
        if (current) setResult({ key: requestKey, value });
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      void invoke('ac_cancel_query', { requestId }).catch(
        () => undefined,
      );
    };
  }, [scope, id, encoded, requestKey]);
  return { data, busy, error };
}
export function xmlValue(
  node: XmlNode | undefined,
  group: string,
  key: string,
) {
  const child = node?.children.find((n) => n.name === group);
  return (
    child?.attrs[key] ??
    child?.children.find((n) => n.name === key)?.text ??
    null
  );
}
export const XML_FIELDS: Record<string, string[]> = {
  Gain: ['Value', 'Savings', 'CacheHit'],
  Client: [
    'Address',
    'Port',
    'RemoteAddress',
    'RemotePort',
    'LocalAddress',
    'LocalPort',
    'AddressInfo',
    'Bytes',
    'Active',
    'StartTime',
    'EndTime',
  ],
  Server: [
    'Address',
    'Port',
    'ClientDestAddress',
    'ClientDestPort',
    'RemoteAddress',
    'RemotePort',
    'LocalAddress',
    'LocalPort',
    'AddressInfo',
    'Bytes',
    'Active',
    'StartTime',
    'EndTime',
  ],
  Age: ['Seconds'],
  Duration: ['Seconds'],
  Routing: [
    'SOCKS',
    'SOCKSInfo',
    'Forwarding',
    'ForwardingInfo',
    'FromCache',
    'FromCacheInfo',
  ],
  Service: ['Name', 'Application', 'Protocol'],
  ICAPREQMOD: ['Status'],
  ICAPRESPMOD: ['Status'],
  Acceleration: ['ObjectCache', 'Latency', 'BandwidthManagement'],
  Details: ['Subsystem', 'Error', 'Text'],
};
