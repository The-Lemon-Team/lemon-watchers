export interface WatcherFolder {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  isSystem: boolean;
  watchersCount?: number;
  activeWatchersCount?: number;
  createdAt: string;
}

export type WatcherProtocol = 'rss' | 'atom' | 'json_api' | 'sse';

export type WatcherStatus =
  | 'IDLE'
  | 'POLLING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'ERROR'
  | 'PAUSED';

export interface WatcherState {
  id: string;
  slug: string;
  title: string;
  category: string;
  feedSlug: string;
  status: WatcherStatus;
  lastPingAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  etag: string | null;
  lastModified: string | null;
  consecutiveFailures: number;
  totalPings: number;
  totalItemsIngested: number;
  lastLatencyMs: number;
  url?: string;
  protocol?: WatcherProtocol;
  pollIntervalSeconds?: number;
  enabled?: boolean;
}

export interface WatcherArticle {
  id: string;
  watcherId: string;
  watcherSlug?: string;
  watcherTitle?: string;
  category?: string;
  guid: string;
  url: string;
  title: string;
  summary: string;
  content: string;
  author: string;
  tags: string[];
  resonanceScore: number;
  contentHash: string;
  publishedAt: string;
  coverUrl?: string | null;
  coverThumbnailUrl?: string | null;
  coverAssetId?: string | null;
  rawPayload?: Record<string, any>;
  busPublishedAt?: string | null;
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

export interface WatcherPingRecord {
  id: string;
  watcherId: string;
  statusCode: number;
  latencyMs: number;
  itemsFound: number;
  newItemsCount: number;
  error?: string | null;
  createdAt: string;
}

export interface PaginatedArticles {
  items: WatcherArticle[];
  total: number;
  limit: number;
  offset: number;
}

export interface StoryEvent {
  id: string;
  type: 'NEWS_COLLECTED' | 'NO_UPDATES' | 'FLOW_ERROR' | 'PROXY_LOG' | 'FLOW_START';
  title: string;
  description: string;
  watcherId?: string;
  watcherTitle?: string;
  statusCode?: number;
  latencyMs?: number;
  itemsCount?: number;
  newItemsCount?: number;
  isProxyOnly?: boolean;
  timestamp: string;
}

export interface ProxyLogRecord {
  id: string;
  url: string;
  protocol: string;
  stage: 'ENQUEUED' | 'FETCHING' | 'SUCCESS' | 'ERROR';
  statusCode?: number;
  latencyMs?: number;
  error?: string | null;
  timestamp: string;
}

export type RawNewsStatus = 'PENDING' | 'CONVERTING' | 'CONVERTED' | 'FAILED';

export interface RawNewsItem {
  id: string;
  watcherId: string;
  watcherSlug?: string;
  watcherTitle?: string;
  category?: string;
  guid: string;
  url: string;
  title: string;
  description: string;
  contentRaw: string;
  author: string;
  pubDate: string;
  categories: string[];
  contentHash: string;
  status: RawNewsStatus;
  noteId?: string | null;
  error?: string | null;
  createdAt: string;
}

export interface PaginatedRawNews {
  items: RawNewsItem[];
  total: number;
  limit: number;
  offset: number;
}
