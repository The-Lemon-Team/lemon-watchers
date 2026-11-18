export type RawNewsStatus = 'PENDING' | 'CONVERTING' | 'CONVERTED' | 'FAILED' | 'DISMISSED';

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
  imageUrl?: string | null;
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
