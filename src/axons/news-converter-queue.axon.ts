import { Subject, Subscription, concatMap, from } from 'rxjs';
import { DatabaseService } from '../db/database.service.js';
import { GeminiSparkAxon } from './gemini-spark.axon.js';
import { BusRelayAxon } from './bus-relay.axon.js';
import { RawNewsItem } from '../types/raw-news.types.js';
import { WatcherArticle } from '../types/article.types.js';
import { StoryEvent } from '../types/story.types.js';
import { RawFeedItem, WatcherConfig } from '../types/watcher.types.js';

export interface NewsConverterQueueOptions {
  db: DatabaseService;
  gemini: GeminiSparkAxon;
  busRelay: BusRelayAxon;
  onArticleConverted?: (article: WatcherArticle) => void;
  onStoryEvent?: (event: StoryEvent) => void;
  getWatcherConfig?: (watcherId: string) => WatcherConfig | undefined;
}

export class NewsConverterQueueAxon {
  private readonly db: DatabaseService;
  private readonly gemini: GeminiSparkAxon;
  private readonly busRelay: BusRelayAxon;
  private readonly onArticleConverted?: (article: WatcherArticle) => void;
  private readonly onStoryEvent?: (event: StoryEvent) => void;
  private readonly getWatcherConfig?: (watcherId: string) => WatcherConfig | undefined;

  private readonly enqueue$ = new Subject<RawNewsItem>();
  private queueSub: Subscription | null = null;
  private isProcessing = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(options: NewsConverterQueueOptions) {
    this.db = options.db;
    this.gemini = options.gemini;
    this.busRelay = options.busRelay;
    this.onArticleConverted = options.onArticleConverted;
    this.onStoryEvent = options.onStoryEvent;
    this.getWatcherConfig = options.getWatcherConfig;

    this.initQueue();
  }

  private initQueue(): void {
    // Process items sequentially to avoid AI API rate limit bursts
    // Note: Automatic interval polling is removed. Conversion is triggered strictly under human supervision.
    this.queueSub = this.enqueue$
      .pipe(
        concatMap((item) => from(this.processItem(item)))
      )
      .subscribe();
  }

  public enqueue(item: RawNewsItem): void {
    this.enqueue$.next(item);
  }

  public async checkPendingItems(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const pending = await this.db.getPendingRawNews(10);
      for (const item of pending) {
        this.enqueue$.next(item);
      }
      return pending.length;
    } finally {
      this.isProcessing = false;
    }
  }

  public async convertById(id: string): Promise<WatcherArticle | null> {
    const raw = await this.db.getRawNewsById(id);
    if (!raw) return null;
    return this.processItem(raw);
  }

  private async processItem(item: RawNewsItem): Promise<WatcherArticle | null> {
    const watcher = this.getWatcherConfig ? this.getWatcherConfig(item.watcherId) : undefined;
    const watcherTitle = watcher?.title || item.watcherTitle || 'Источник новостей';
    const watcherSlug = watcher?.slug || item.watcherSlug || 'feed';
    const feedSlug = watcher?.feedSlug || item.watcherSlug || 'spark';
    const category = watcher?.category || item.category || 'general';

    try {
      await this.db.updateRawNewsStatus(item.id, 'CONVERTING');

      const rawFeedItem: RawFeedItem = {
        guid: item.guid,
        url: item.url,
        title: item.title,
        summary: item.description,
        contentHtml: item.contentRaw,
        rawText: item.contentRaw,
        author: item.author,
        pubDate: item.pubDate,
        categories: item.categories,
      };

      const fallbackConfig: WatcherConfig = watcher || {
        id: item.watcherId,
        slug: watcherSlug,
        title: watcherTitle,
        description: '',
        category,
        feedSlug,
        url: item.url,
        protocol: 'rss',
        pollIntervalSeconds: 900,
        defaultTags: [],
        enabled: true,
      };

      // 1. Enrich with AI (Gemini) or canonical fallback
      const sparkNote = await this.gemini.enrichRawFeedItem(rawFeedItem, fallbackConfig);

      // 2. Insert into lemon_watcher_items
      const article = await this.db.recordIngestedItem({
        id: sparkNote.id,
        watcherId: item.watcherId,
        guid: item.guid,
        url: item.url || sparkNote.sourceLink,
        title: sparkNote.title,
        summary: sparkNote.summary,
        content: sparkNote.rawContent,
        author: sparkNote.author || watcherTitle,
        tags: sparkNote.tags,
        resonanceScore: sparkNote.resonanceScore,
        contentHash: item.contentHash,
        publishedAt: sparkNote.eventDate || item.pubDate || new Date().toISOString(),
        rawPayload: {
          guid: item.guid,
          categories: item.categories,
          feedSlug,
          watcherSlug,
          rawNewsId: item.id,
        },
        noteId: sparkNote.id,
      });

      // 3. Mark raw news as CONVERTED
      await this.db.updateRawNewsStatus(item.id, 'CONVERTED', article.id, null);

      // 4. Notify SSE
      if (this.onArticleConverted) {
        this.onArticleConverted(article);
      }

      // 7. Notify Story
      if (this.onStoryEvent) {
        this.onStoryEvent({
          id: `conv-${article.id}`,
          type: 'NEWS_COLLECTED',
          title: `AI Конвертер: ${watcherTitle}`,
          description: `Создана заметка «${article.title}» (${article.tags.join(', ')})`,
          watcherId: item.watcherId,
          watcherTitle,
          newItemsCount: 1,
          isProxyOnly: false,
          timestamp: new Date().toISOString(),
        });
      }

      return article;
    } catch (err: any) {
      console.error(
        `[NewsConverterQueue] Failed to convert raw item ${item.id} («${item.title}»):`,
        err?.message || err
      );

      await this.db.updateRawNewsStatus(item.id, 'FAILED', null, err?.message || 'Conversion error');

      if (this.onStoryEvent) {
        this.onStoryEvent({
          id: `conv-err-${item.id}`,
          type: 'FLOW_ERROR',
          title: `AI Конвертер: Ошибка`,
          description: `Не удалось обработать «${item.title}»: ${err?.message || err}`,
          watcherId: item.watcherId,
          watcherTitle,
          isProxyOnly: false,
          timestamp: new Date().toISOString(),
        });
      }

      return null;
    }
  }

  public destroy(): void {
    if (this.queueSub) {
      this.queueSub.unsubscribe();
      this.queueSub = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
