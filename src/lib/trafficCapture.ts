import type {
  TrafficDataset,
  TrafficRecord,
} from './trafficAnalysis';

export type CaptureFilters = {
  search: string;
  client: string;
  user: string;
  host: string;
  threat: string;
  method: string;
  category: string;
  action: string;
  status: string;
};
export const emptyCaptureFilters: CaptureFilters = {
  search: '',
  client: '',
  user: '',
  host: '',
  threat: '',
  method: '',
  category: '',
  action: '',
  status: '',
};
export type CaptureRange = {
  start: number | null;
  end: number | null;
};
export type CaptureRanking = {
  name: string;
  value: number;
  requests: number;
  bytes: number;
  percentage: number;
};
export type CaptureResult = {
  summary: {
    requests: number;
    bytes: number;
    issues: number;
    denied: number;
    uniqueUsers: number;
    uniqueClients: number;
    uniqueDestinations: number;
    first: number | null;
    last: number | null;
    requestsPerSecond: number;
    bytesPerSecond: number;
  };
  rankings: Record<string, CaptureRanking[]>;
  networkRankings?: {
    name: string;
    requests: number;
    bytes: number;
    clients: number;
    percentage: number;
  }[];
  networkMembers?: CaptureRanking[];
  networkMemberCount?: number;
  networkCount?: number;
  timeline: TrafficDataset['timeline'];
  records: TrafficRecord[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  diagnostics: TrafficDataset['diagnostics'];
  diagnosticsTotal: number;
  options: Record<string, string[]>;
};
export type CaptureArchive = {
  id: string;
  source: string;
  records: number;
  savedAt: string;
  path: string;
};
export type AccessLogSource = { name: string; url: string };
export type CaptureStreamStatus = {
  streamId: string;
  captureId: string;
  status: string;
  url: string;
  message: string;
};
