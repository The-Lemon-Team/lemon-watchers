export interface WatcherPingRecord {
  id: string;
  watcherId: string;
  statusCode: number;
  latencyMs: number;
  itemsFound: number;
  newItemsCount: number;
  error: string | null;
  createdAt: string;
}

export interface WatcherItemLogRecord {
  id: string;
  watcherId: string;
  guid: string;
  url: string;
  contentHash: string;
  publishedAt: string;
  noteId: string | null;
  createdAt: string;
}

export interface WatcherMetricsSnapshot {
  activeWatchers: number;
  totalWatchers: number;
  totalPings: number;
  totalNotesIngested: number;
  avgLatencyMs: number;
  successRatePercent: number;
  timestamp: string;
}
