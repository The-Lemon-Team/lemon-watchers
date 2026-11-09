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
  rawPayload?: Record<string, any>;
  busPublishedAt?: string | null;
  createdAt: string;
}

export interface WatcherArticleQueryOptions {
  limit?: number;
  offset?: number;
  watcherId?: string;
  category?: string;
  search?: string;
}

export interface PaginatedArticles {
  items: WatcherArticle[];
  total: number;
  limit: number;
  offset: number;
}
