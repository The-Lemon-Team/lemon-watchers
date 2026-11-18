export type WatcherCategory = 'ai' | 'cybersec' | 'habr' | 'politics' | 'frontier' | string;

export type WatcherProtocol = 'rss' | 'atom' | 'json_api' | 'sse';

export type WatcherNeuronStatus =
  | 'IDLE'
  | 'POLLING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'ERROR'
  | 'PAUSED';

export interface WatcherFolder {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  isSystem: boolean;
  watchersCount?: number;
  createdAt: string;
}

export interface WatcherConfig {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: WatcherCategory;
  feedSlug: string;
  url: string;
  protocol: WatcherProtocol;
  pollIntervalSeconds: number;
  cronExpression?: string;
  defaultTags: string[];
  isPrimary?: boolean;
  enabled: boolean;
}

export interface WatcherState {
  id: string;
  slug: string;
  title: string;
  category: WatcherCategory;
  feedSlug: string;
  status: WatcherNeuronStatus;
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

export interface RawFeedItem {
  guid: string;
  url: string;
  title: string;
  summary: string;
  contentHtml?: string;
  rawText?: string;
  pubDate: string; // ISO 8601 string
  author?: string;
  categories?: string[];
  imageUrl?: string;
  contentOrigin?: 'feed' | 'scraped' | 'ai_generated';
}
