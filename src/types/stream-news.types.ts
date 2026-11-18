import { RawNewsItem, RawNewsStatus } from './raw-news.types.js';
import { WatcherPingRecord } from './ping.types.js';

export type StreamNewsStatus = 'NEW' | 'CONVERTING' | 'PROMOTED' | 'DISMISSED' | 'FAILED';

export interface StreamNewsItem {
  id: string;
  watcherId: string;
  watcherSlug: string;
  watcherTitle: string;
  category: string;
  feedSlug: string;
  guid: string;
  url: string;
  title: string;
  teaser: string;
  imageUrl?: string | null;
  author: string;
  pubDate: string;
  categories: string[];
  status: StreamNewsStatus;
  noteId?: string | null;
  createdAt: string;
}

export interface StreamCounts {
  newCount: number;
  promotedCount: number;
  dismissedCount: number;
  totalCount: number;
}

export interface PaginatedStreamNews {
  items: StreamNewsItem[];
  total: number;
  limit: number;
  offset: number;
  counts?: StreamCounts;
}

export interface StreamQueryOptions {
  limit?: number;
  offset?: number;
  categories?: string[];
  watchers?: string[];
  status?: StreamNewsStatus | 'ALL';
  search?: string;
}

export type StreamLiveEventType =
  | 'news_item'
  | 'news_promoted'
  | 'news_dismissed'
  | 'watcher_ping'
  | 'heartbeat';

export interface StreamLiveEvent {
  id: string;
  type: StreamLiveEventType;
  timestamp: string;
  category?: string;
  watcherId?: string;
  watcherSlug?: string;
  item?: StreamNewsItem;
  itemIds?: string[];
  articleId?: string;
  noteId?: string | null;
  ping?: WatcherPingRecord;
}

export function mapRawStatusToStreamStatus(status: RawNewsStatus | string): StreamNewsStatus {
  switch (status) {
    case 'CONVERTED':
      return 'PROMOTED';
    case 'DISMISSED':
      return 'DISMISSED';
    case 'CONVERTING':
      return 'CONVERTING';
    case 'FAILED':
      return 'FAILED';
    case 'PENDING':
    default:
      return 'NEW';
  }
}

export function mapStreamStatusToRawStatus(status: StreamNewsStatus | string): RawNewsStatus | undefined {
  switch (status) {
    case 'NEW':
      return 'PENDING';
    case 'PROMOTED':
      return 'CONVERTED';
    case 'DISMISSED':
      return 'DISMISSED';
    case 'CONVERTING':
      return 'CONVERTING';
    case 'FAILED':
      return 'FAILED';
    default:
      return undefined;
  }
}

export function stripHtmlToTeaser(rawHtmlOrText: string, maxLength = 360): string {
  if (!rawHtmlOrText) return '';
  const plain = rawHtmlOrText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();

  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength - 1).trimEnd()}…`;
}

export function toStreamNewsItem(
  raw: RawNewsItem,
  meta?: { watcherSlug?: string; watcherTitle?: string; category?: string; feedSlug?: string }
): StreamNewsItem {
  const watcherSlug = meta?.watcherSlug || raw.watcherSlug || raw.watcherId;
  const watcherTitle = meta?.watcherTitle || raw.watcherTitle || watcherSlug;
  const category = meta?.category || raw.category || 'general';
  const feedSlug = meta?.feedSlug || `spark-${category}`;
  const teaserSource = raw.description || raw.contentRaw || '';

  return {
    id: raw.id,
    watcherId: raw.watcherId,
    watcherSlug,
    watcherTitle,
    category,
    feedSlug,
    guid: raw.guid,
    url: raw.url,
    title: raw.title,
    teaser: stripHtmlToTeaser(teaserSource, 360),
    imageUrl: raw.imageUrl ?? null,
    author: raw.author || watcherTitle,
    pubDate: raw.pubDate,
    categories: raw.categories || [],
    status: mapRawStatusToStreamStatus(raw.status),
    noteId: raw.noteId ?? null,
    createdAt: raw.createdAt,
  };
}
