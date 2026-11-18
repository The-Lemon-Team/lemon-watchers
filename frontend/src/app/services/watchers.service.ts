import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, Subject } from 'rxjs';
import {
  WatcherFolder,
  WatcherState,
  WatcherArticle,
  WatcherMetricsSnapshot,
  WatcherPingRecord,
  PaginatedArticles,
  StoryEvent,
  RawNewsItem,
  PaginatedRawNews,
} from '../models';

@Injectable({
  providedIn: 'root',
})
export class WatchersService {
  private http = inject(HttpClient);
  private apiBase = '/api/v1';

  // SSE Event Streams
  public sseConnected$ = new Subject<boolean>();
  public pingEvents$ = new Subject<WatcherPingRecord>();
  public articleEvents$ = new Subject<WatcherArticle>();
  public metricsEvents$ = new Subject<WatcherMetricsSnapshot>();
  public storyEvents$ = new Subject<StoryEvent>();

  private eventSource: EventSource | null = null;

  initSSE(): void {
    if (this.eventSource) return;

    try {
      this.eventSource = new EventSource(`${this.apiBase}/watchers/live`);

      this.eventSource.onopen = () => {
        this.sseConnected$.next(true);
      };

      this.eventSource.onerror = () => {
        this.sseConnected$.next(false);
      };

      this.eventSource.addEventListener('ping', (event: MessageEvent) => {
        try {
          const data: WatcherPingRecord = JSON.parse(event.data);
          this.pingEvents$.next(data);
        } catch (e) {
          console.error('Error parsing SSE ping:', e);
        }
      });

      this.eventSource.addEventListener('article', (event: MessageEvent) => {
        try {
          const data: WatcherArticle = JSON.parse(event.data);
          this.articleEvents$.next(data);
        } catch (e) {
          console.error('Error parsing SSE article:', e);
        }
      });

      this.eventSource.addEventListener('note', (event: MessageEvent) => {
        try {
          const data: WatcherArticle = JSON.parse(event.data);
          this.articleEvents$.next(data);
        } catch (e) {
          console.error('Error parsing SSE note:', e);
        }
      });

      this.eventSource.addEventListener('metrics', (event: MessageEvent) => {
        try {
          const data: WatcherMetricsSnapshot = JSON.parse(event.data);
          this.metricsEvents$.next(data);
        } catch (e) {
          console.error('Error parsing SSE metrics:', e);
        }
      });

      this.eventSource.addEventListener('story', (event: MessageEvent) => {
        try {
          const data: StoryEvent = JSON.parse(event.data);
          this.storyEvents$.next(data);
        } catch (e) {
          console.error('Error parsing SSE story:', e);
        }
      });
    } catch (err) {
      console.warn('Failed to establish EventSource:', err);
    }
  }

  closeSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // Folders API
  getFolders(): Observable<{ total: number; items: WatcherFolder[] }> {
    return this.http.get<{ total: number; items: WatcherFolder[] }>(
      `${this.apiBase}/folders`
    );
  }

  createFolder(data: {
    title: string;
    slug?: string;
    icon?: string;
    color?: string;
    description?: string;
  }): Observable<WatcherFolder> {
    return this.http.post<WatcherFolder>(`${this.apiBase}/folders`, data);
  }

  deleteFolder(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/folders/${id}`);
  }

  // Watchers API
  getWatchers(): Observable<{ total: number; items: WatcherState[] }> {
    return this.http.get<{ total: number; items: WatcherState[] }>(
      `${this.apiBase}/watchers`
    );
  }

  addWatcher(data: {
    title: string;
    slug?: string;
    url: string;
    category: string;
    protocol?: string;
    pollIntervalSeconds?: number;
    defaultTags?: string[];
    description?: string;
  }): Observable<{ config: any; state: WatcherState }> {
    return this.http.post<{ config: any; state: WatcherState }>(
      `${this.apiBase}/watchers`,
      data
    );
  }

  deleteWatcher(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiBase}/watchers/${id}`);
  }

  toggleWatcher(id: string, enabled: boolean): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.apiBase}/watchers/${id}`, {
      enabled,
    });
  }

  updateWatcher(
    id: string,
    data: Partial<{
      title: string;
      description: string;
      category: string;
      url: string;
      protocol: string;
      pollIntervalSeconds: number;
      defaultTags: string[];
      enabled: boolean;
    }>
  ): Observable<{ message: string; watcher: WatcherState }> {
    return this.http.patch<{ message: string; watcher: WatcherState }>(
      `${this.apiBase}/watchers/${id}`,
      data
    );
  }

  getWatcherArticles(
    watcherId: string,
    limit: number = 20,
    offset: number = 0
  ): Observable<PaginatedArticles> {
    return this.getArticles({ watcherId, limit, offset });
  }

  getWatcherPingHistory(
    watcherId: string,
    limit: number = 50
  ): Observable<{ watcherId: string; count: number; items: WatcherPingRecord[] }> {
    return this.http.get<{ watcherId: string; count: number; items: WatcherPingRecord[] }>(
      `${this.apiBase}/watchers/${watcherId}/history`,
      { params: { limit: limit.toString() } }
    );
  }

  getStory(
    limit: number = 50,
    includeProxy: boolean = true
  ): Observable<{ total: number; items: StoryEvent[] }> {
    return this.http.get<{ total: number; items: StoryEvent[] }>(
      `${this.apiBase}/story`,
      {
        params: {
          limit: limit.toString(),
          includeProxy: includeProxy.toString(),
        },
      }
    );
  }

  triggerWatcher(id: string): Observable<WatcherPingRecord> {
    return this.http.post<WatcherPingRecord>(
      `${this.apiBase}/watchers/${id}/trigger`,
      {}
    );
  }

  triggerAll(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiBase}/watchers/trigger-all`,
      {}
    );
  }

  pauseAll(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiBase}/watchers/pause-all`,
      {}
    );
  }

  resumeAll(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiBase}/watchers/resume-all`,
      {}
    );
  }

  validateFeedUrl(
    url: string,
    protocol: string = 'rss'
  ): Observable<{
    valid: boolean;
    statusCode: number;
    itemsCount: number;
    sample: any[];
    error?: string;
  }> {
    return this.http.post<{
      valid: boolean;
      statusCode: number;
      itemsCount: number;
      sample: any[];
      error?: string;
    }>(`${this.apiBase}/watchers/validate`, { url, protocol });
  }

  // Articles API
  getArticles(params: {
    limit?: number;
    offset?: number;
    category?: string;
    watcherId?: string;
    search?: string;
  }): Observable<PaginatedArticles> {
    let httpParams = new HttpParams();
    if (params.limit !== undefined) httpParams = httpParams.set('limit', params.limit);
    if (params.offset !== undefined) httpParams = httpParams.set('offset', params.offset);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.watcherId) httpParams = httpParams.set('watcherId', params.watcherId);
    if (params.search) httpParams = httpParams.set('search', params.search);

    return this.http.get<PaginatedArticles>(`${this.apiBase}/items`, {
      params: httpParams,
    });
  }

  // Metrics API
  getMetrics(): Observable<WatcherMetricsSnapshot> {
    return this.http.get<WatcherMetricsSnapshot>(`${this.apiBase}/metrics`);
  }

  // Raw News API (Stage 1 collection)
  getRawNews(params: {
    limit?: number;
    offset?: number;
    category?: string;
    watcherId?: string;
    status?: string;
    search?: string;
  } = {}): Observable<PaginatedRawNews> {
    let httpParams = new HttpParams();
    if (params.limit !== undefined) httpParams = httpParams.set('limit', params.limit);
    if (params.offset !== undefined) httpParams = httpParams.set('offset', params.offset);
    if (params.category) httpParams = httpParams.set('category', params.category);
    if (params.watcherId) httpParams = httpParams.set('watcherId', params.watcherId);
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.search) httpParams = httpParams.set('search', params.search);

    return this.http.get<PaginatedRawNews>(`${this.apiBase}/raw-news`, {
      params: httpParams,
    });
  }

  convertRawNews(id: string): Observable<{ message: string; article: WatcherArticle }> {
    return this.http.post<{ message: string; article: WatcherArticle }>(
      `${this.apiBase}/raw-news/${id}/convert`,
      {}
    );
  }

  processPendingRawNews(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiBase}/raw-news/process-pending`,
      {}
    );
  }

  convertRawNewsBatch(ids: string[]): Observable<{ count: number; articles: WatcherArticle[] }> {
    return this.http.post<{ count: number; articles: WatcherArticle[] }>(
      `${this.apiBase}/raw-news/batch-convert`,
      { ids }
    );
  }

  convertAndPublishRawNewsBatch(ids: string[]): Observable<{ count: number; articles: WatcherArticle[] }> {
    return this.http.post<{ count: number; articles: WatcherArticle[] }>(
      `${this.apiBase}/raw-news/batch-convert-and-publish`,
      { ids }
    );
  }

  convertAndPublishSingleRawNews(id: string): Observable<{ message: string; article: WatcherArticle }> {
    return this.http.post<{ message: string; article: WatcherArticle }>(
      `${this.apiBase}/raw-news/${id}/convert-and-publish`,
      {}
    );
  }

  // AI & Media Cover Actions
  generateArticleCover(
    id: string,
    options?: { prompt?: string; style?: string; aspectRatio?: string }
  ): Observable<{ message: string; article: WatcherArticle }> {
    return this.http.post<{ message: string; article: WatcherArticle }>(
      `${this.apiBase}/items/${id}/generate-cover`,
      options || {}
    );
  }

  fetchOriginalCover(
    id: string,
    imageUrl?: string
  ): Observable<{ message: string; article: WatcherArticle }> {
    return this.http.post<{ message: string; article: WatcherArticle }>(
      `${this.apiBase}/items/${id}/fetch-original-cover`,
      imageUrl ? { imageUrl } : {}
    );
  }

  assistArticleContent(
    id: string,
    options: { action: 'rewrite' | 'expand' | 'summarize' | 'custom'; instruction?: string }
  ): Observable<{ message: string; article: WatcherArticle }> {
    return this.http.post<{ message: string; article: WatcherArticle }>(
      `${this.apiBase}/items/${id}/ai-assist`,
      options
    );
  }

  // LemonBus Publishing & Bridge API
  publishArticleToBus(id: string): Observable<{ message: string; article: WatcherArticle }> {
    return this.http.post<{ message: string; article: WatcherArticle }>(
      `${this.apiBase}/items/${id}/publish-bus`,
      {}
    );
  }

  publishArticlesBatchToBus(ids: string[]): Observable<{ count: number; articles: WatcherArticle[] }> {
    return this.http.post<{ count: number; articles: WatcherArticle[] }>(
      `${this.apiBase}/items/batch-publish-bus`,
      { ids }
    );
  }

  publishAllPendingBus(): Observable<{ message: string; count: number }> {
    return this.http.post<{ message: string; count: number }>(
      `${this.apiBase}/items/publish-bus-pending`,
      {}
    );
  }

  getBusStatus(): Observable<{
    busUrl: string;
    deviceId: string;
    activeSseSubscribers: number;
    total: number;
    published: number;
    pending: number;
  }> {
    return this.http.get<{
      busUrl: string;
      deviceId: string;
      activeSseSubscribers: number;
      total: number;
      published: number;
      pending: number;
    }>(`${this.apiBase}/bus/status`);
  }
}
