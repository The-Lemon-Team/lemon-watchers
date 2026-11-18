import { Subject } from 'rxjs';
import crypto from 'node:crypto';
import { ALL_VERIFIED_SOURCES } from '../sources/sources-catalog.js';
import { WatcherConfig, WatcherState, WatcherFolder } from '../types/watcher.types.js';
import { WatcherPingRecord, WatcherMetricsSnapshot } from '../types/ping.types.js';
import { WatcherArticle, WatcherArticleQueryOptions, PaginatedArticles } from '../types/article.types.js';
import { DatabaseService } from '../db/database.service.js';
import { GeminiSparkAxon } from '../axons/gemini-spark.axon.js';
import { BusRelayAxon } from '../axons/bus-relay.axon.js';
import { WatcherNeuron } from '../neurons/watcher.neuron.js';
import { WatchersSseManager } from '../server/watchers-sse.manager.js';
import { AppConfig } from '../config.js';
import { proxyQueue, ProxyLogRecord } from '../axons/proxy-queue.axon.js';
import { StoryEvent } from '../types/story.types.js';
import { NewsConverterQueueAxon } from '../axons/news-converter-queue.axon.js';
import { RawNewsItem, PaginatedRawNews } from '../types/raw-news.types.js';
import {
  PaginatedStreamNews,
  StreamLiveEvent,
  StreamNewsItem,
  StreamQueryOptions,
  toStreamNewsItem,
} from '../types/stream-news.types.js';
import { CoreCombinatorClient } from '@lemon/core-combinator-sdk';
import { AiStudioAxon, ImageAspectRatio } from '@lemon/ai-neurons';
import { MediaLifecycleAxon } from '@lemon/media-hub-neurons';
import { MediaCoverAxon } from '../axons/media-cover.axon.js';
import { ArticleExtractorAxon } from '../axons/article-extractor.axon.js';
import { extractFirstImageFromHtml } from '../axons/rss-atom-fetcher.axon.js';
import { AiAssistAction } from '../axons/gemini-spark.axon.js';

export class WatchersEngine {
  private readonly neurons = new Map<string, WatcherNeuron>();
  private readonly db: DatabaseService;
  private readonly gemini: GeminiSparkAxon;
  private readonly busRelay: BusRelayAxon;
  public readonly sse: WatchersSseManager;
  public readonly combinator?: CoreCombinatorClient;
  public readonly aiStudio?: AiStudioAxon;
  public readonly mediaHub?: MediaLifecycleAxon;
  public readonly mediaCover: MediaCoverAxon;
  private readonly articleExtractor: ArticleExtractorAxon;
  private readonly converterQueue: NewsConverterQueueAxon;
  private readonly storyBuffer: StoryEvent[] = [];
  public readonly streamEvents$ = new Subject<StreamLiveEvent>();
  private readonly streamReplayBuffer: StreamLiveEvent[] = [];
  private readonly maxStreamReplaySize = 300;
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfig) {
    this.combinator = config.enableCoreCombinator
      ? new CoreCombinatorClient({ baseUrl: config.coreCombinatorUrl })
      : undefined;
    this.aiStudio = config.enableAiService
      ? new AiStudioAxon({
          baseUrl: config.aiServiceUrl,
          apiKey: config.aiServiceApiKey,
          combinator: this.combinator,
          basePath: '/watchers/ai',
        })
      : undefined;
    this.mediaHub = config.enableMediaHub
      ? new MediaLifecycleAxon({
          baseUrl: config.mediaHubUrl,
          apiKey: config.mediaHubApiKey,
          combinator: this.combinator,
          basePath: '/watchers/media',
          folderPath: 'covers',
          autoConnectSse: false,
        })
      : undefined;
    this.mediaCover = new MediaCoverAxon({
      aiStudio: this.aiStudio,
      mediaHub: this.mediaHub,
      mediaHubBaseUrl: config.mediaHubUrl,
      proxyUrl: config.watcherProxyUrl || config.httpsProxy || config.httpProxy,
      enabled: config.enableCoverGeneration,
    });
    this.articleExtractor = new ArticleExtractorAxon({
      proxyUrl: config.watcherProxyUrl || config.httpsProxy || config.httpProxy,
    });
    this.db = new DatabaseService(config.databaseUrl);
    this.gemini = new GeminiSparkAxon({
      apiKey: config.geminiApiKey,
      modelName: config.geminiModel,
      proxyUrl: config.httpsProxy || config.httpProxy,
      enabled: config.enableAiEnrichment,
      aiStudio: this.aiStudio,
    });
    this.busRelay = new BusRelayAxon({
      busUrl: config.lemonBusUrl,
      deviceId: config.deviceId,
      moderationMode: config.busModerationMode,
    });
    this.sse = new WatchersSseManager();

    this.converterQueue = new NewsConverterQueueAxon({
      db: this.db,
      gemini: this.gemini,
      busRelay: this.busRelay,
      mediaCover: this.mediaCover,
      articleExtractor: this.articleExtractor,
      onArticleConverted: (article) => {
        this.sse.broadcastArticle(article);
      },
      onStoryEvent: (event) => {
        this.addStoryItem(event);
      },
      getWatcherConfig: (watcherId) => {
        const neuron = this.neurons.get(watcherId);
        return neuron?.config;
      },
    });

    // Forward bus relay events to reactive SSE bridge
    this.busRelay.busEvents$.subscribe((envelope) => {
      this.sse.broadcastBusEnvelope(envelope);
    });

    // Listen to proxy logs and feed into story
    proxyQueue.proxyLogs$.subscribe((log) => {
      this.sse.broadcastProxyLog(log);
      if (log.stage === 'SUCCESS' || log.stage === 'ERROR') {
        const item: StoryEvent = {
          id: log.id,
          type: 'PROXY_LOG',
          title: `Прокси: ${log.protocol.toUpperCase()} ${log.stage}`,
          description: `${log.url} (HTTP ${log.statusCode || '—'}, ${log.latencyMs || 0}ms)${log.error ? ` Ошибка: ${log.error}` : ''}`,
          statusCode: log.statusCode,
          latencyMs: log.latencyMs,
          isProxyOnly: true,
          timestamp: log.timestamp,
        };
        this.addStoryItem(item);
      }
    });
  }

  async initialize(): Promise<void> {
    console.log('🍋 [WatchersEngine] Initializing autonomous PostgreSQL schema...');
    await this.db.initSchema();

    if (this.aiStudio) {
      await this.aiStudio
        .start({ ensureCombinatorTopology: Boolean(this.combinator), loadHistory: false })
        .catch((err) => {
          console.warn(`⚠️ [WatchersEngine] AiStudioAxon init warning: ${err?.message || err}`);
        });
    }

    if (this.mediaHub) {
      await this.mediaHub
        .start({ ensureCombinatorTopology: Boolean(this.combinator), loadInitial: false })
        .catch((err) => {
          console.warn(`⚠️ [WatchersEngine] MediaLifecycleAxon init warning: ${err?.message || err}`);
        });
    }

    console.log(
      `🍋 [WatchersEngine] Registering ${ALL_VERIFIED_SOURCES.length} verified news watchers...`
    );

    let initialStaggerSec = 1;

    for (const source of ALL_VERIFIED_SOURCES) {
      const persistedState = await this.db.upsertWatcher(source);
      const isEnabled = persistedState.enabled ?? source.enabled;
      const watcherConfig: WatcherConfig = { ...source, enabled: isEnabled };

      const neuron = new WatcherNeuron({
        config: watcherConfig,
        initialState: persistedState,
        db: this.db,
        gemini: this.gemini,
        busRelay: this.busRelay,
        combinator: this.combinator,
        initialDelaySeconds: initialStaggerSec,
      });

      this.bindNeuronEvents(neuron);

      this.neurons.set(source.id, neuron);
      this.neurons.set(source.slug, neuron);

      if (isEnabled) {
        await neuron.start();
      } else {
        neuron.stop();
      }

      // Stagger subsequent watchers by 2 seconds to prevent initial fetch flood
      initialStaggerSec += 2;
    }

    // Run initial TTL cleanup and schedule periodic pruning every 6 hours
    this.pruneExpiredRawNews().catch((err) => {
      console.warn(`⚠️ [WatchersEngine] Initial raw news TTL prune warning: ${err?.message || err}`);
    });
    this.pruneTimer = setInterval(() => {
      this.pruneExpiredRawNews().catch((err) => {
        console.warn(`⚠️ [WatchersEngine] Scheduled raw news TTL prune warning: ${err?.message || err}`);
      });
    }, 6 * 60 * 60 * 1000);

    console.log('✅ [WatchersEngine] All Watcher Neurons are active and scheduled.');
  }

  getAllWatchers(): WatcherState[] {
    const unique = new Map<string, WatcherState>();
    for (const neuron of this.neurons.values()) {
      unique.set(neuron.config.id, {
        ...neuron.state,
        enabled: neuron.config.enabled,
      });
    }
    return Array.from(unique.values());
  }

  async pauseAll(): Promise<number> {
    const uniqueNeurons = Array.from(new Set(this.neurons.values()));
    for (const neuron of uniqueNeurons) {
      neuron.config.enabled = false;
      neuron.stop();
      await this.db.setWatcherEnabled(neuron.config.id, false);
    }
    return uniqueNeurons.length;
  }

  async resumeAll(): Promise<number> {
    const uniqueNeurons = Array.from(new Set(this.neurons.values()));
    for (const neuron of uniqueNeurons) {
      neuron.config.enabled = true;
      await neuron.start();
      await this.db.setWatcherEnabled(neuron.config.id, true);
    }
    return uniqueNeurons.length;
  }

  getWatcher(idOrSlug: string): WatcherNeuron | undefined {
    return this.neurons.get(idOrSlug);
  }

  async triggerWatcher(idOrSlug: string, force = true): Promise<WatcherPingRecord | null> {
    const neuron = this.neurons.get(idOrSlug);
    if (!neuron) return null;
    return neuron.poll(force);
  }

  async triggerAll(): Promise<number> {
    const uniqueNeurons = Array.from(new Set(this.neurons.values()));
    let count = 0;
    for (const neuron of uniqueNeurons) {
      if (neuron.config.enabled) {
        neuron.triggerManualPoll();
        count++;
      }
    }
    return count;
  }

  async getPingHistory(idOrSlug: string, limit = 50): Promise<WatcherPingRecord[]> {
    const neuron = this.neurons.get(idOrSlug);
    if (!neuron) return [];
    return this.db.getPingHistory(neuron.config.id, limit);
  }

  async getMetrics(): Promise<WatcherMetricsSnapshot> {
    return this.db.getMetrics();
  }

  async getRecentItems(options: WatcherArticleQueryOptions): Promise<PaginatedArticles> {
    return this.db.getRecentItems(options);
  }

  async getItemById(id: string): Promise<WatcherArticle | null> {
    return this.db.getItemById(id);
  }

  async addWatcher(config: WatcherConfig): Promise<WatcherState> {
    const persistedState = await this.db.upsertWatcher(config);

    // Stop existing neuron if replacing
    const existing = this.neurons.get(config.id) || this.neurons.get(config.slug);
    if (existing) {
      existing.stop();
      this.neurons.delete(existing.config.id);
      this.neurons.delete(existing.config.slug);
    }

    const neuron = new WatcherNeuron({
      config,
      initialState: persistedState,
      db: this.db,
      gemini: this.gemini,
      busRelay: this.busRelay,
      combinator: this.combinator,
      initialDelaySeconds: 1,
    });

    this.bindNeuronEvents(neuron);

    this.neurons.set(config.id, neuron);
    this.neurons.set(config.slug, neuron);

    if (config.enabled) {
      await neuron.start();
    }

    return neuron.state;
  }

  async deleteWatcher(idOrSlug: string): Promise<boolean> {
    const neuron = this.neurons.get(idOrSlug);
    if (neuron) {
      neuron.stop();
      this.neurons.delete(neuron.config.id);
      this.neurons.delete(neuron.config.slug);
    }
    return this.db.deleteWatcher(idOrSlug);
  }

  async setWatcherEnabled(idOrSlug: string, enabled: boolean): Promise<boolean> {
    const neuron = this.neurons.get(idOrSlug);
    if (neuron) {
      neuron.config.enabled = enabled;
      if (enabled) {
        await neuron.start();
      } else {
        neuron.stop();
      }
    }
    return this.db.setWatcherEnabled(idOrSlug, enabled);
  }

  async updateWatcher(idOrSlug: string, updates: Partial<WatcherConfig>): Promise<WatcherState | null> {
    const updatedState = await this.db.updateWatcherConfig(idOrSlug, updates);
    if (!updatedState) return null;

    const neuron = this.neurons.get(idOrSlug);
    if (neuron) {
      if (updates.title) neuron.config.title = updates.title;
      if (updates.description !== undefined) neuron.config.description = updates.description;
      if (updates.category) neuron.config.category = updates.category;
      if (updates.url) neuron.config.url = updates.url;
      if (updates.protocol) neuron.config.protocol = updates.protocol;
      if (updates.pollIntervalSeconds) neuron.config.pollIntervalSeconds = updates.pollIntervalSeconds;
      if (updates.defaultTags) neuron.config.defaultTags = updates.defaultTags;
      if (typeof updates.enabled === 'boolean') {
        neuron.config.enabled = updates.enabled;
        if (updates.enabled) {
          await neuron.start();
        } else {
          neuron.stop();
        }
      }
    }
    return updatedState;
  }

  async getFolders(): Promise<WatcherFolder[]> {
    return this.db.getFolders();
  }

  async createFolder(data: {
    title: string;
    slug?: string;
    icon?: string;
    color?: string;
    description?: string;
  }): Promise<WatcherFolder> {
    return this.db.createFolder(data);
  }

  async deleteFolder(idOrSlug: string): Promise<boolean> {
    return this.db.deleteFolder(idOrSlug);
  }

  addStoryItem(item: StoryEvent): void {
    this.storyBuffer.unshift(item);
    if (this.storyBuffer.length > 200) {
      this.storyBuffer.pop();
    }
    this.sse.broadcastStory(item);
  }

  getRecentStory(limit = 50, includeProxy = true): StoryEvent[] {
    const filtered = includeProxy
      ? this.storyBuffer
      : this.storyBuffer.filter((i) => !i.isProxyOnly);
    return filtered.slice(0, limit);
  }

  private bindNeuronEvents(neuron: WatcherNeuron): void {
    neuron.pingFlow$.subscribe((ping) => {
      this.sse.broadcastPing(ping);

      const title = neuron.config.title;
      let item: StoryEvent;

      if (ping.error) {
        item = {
          id: ping.id,
          type: 'FLOW_ERROR',
          title: `${title}: Ошибка связи`,
          description: ping.error,
          watcherId: ping.watcherId,
          watcherTitle: title,
          statusCode: ping.statusCode,
          latencyMs: ping.latencyMs,
          isProxyOnly: false,
          timestamp: ping.createdAt,
        };
      } else if (ping.newItemsCount > 0) {
        item = {
          id: ping.id,
          type: 'NEWS_COLLECTED',
          title: `${title}: Получено ${ping.newItemsCount} новых новостей`,
          description: `Всего в ленте: ${ping.itemsFound}, сохранено: +${ping.newItemsCount} (HTTP ${ping.statusCode}, ${ping.latencyMs}ms)`,
          watcherId: ping.watcherId,
          watcherTitle: title,
          statusCode: ping.statusCode,
          latencyMs: ping.latencyMs,
          itemsCount: ping.itemsFound,
          newItemsCount: ping.newItemsCount,
          isProxyOnly: false,
          timestamp: ping.createdAt,
        };
      } else {
        item = {
          id: ping.id,
          type: 'NO_UPDATES',
          title: `${title}: 0 новых новостей`,
          description:
            ping.statusCode === 304
              ? `Сервер вернул 304 Not Modified. Трафик сэкономлен (${ping.latencyMs}ms)`
              : `Все ${ping.itemsFound} публикаций актуальны, дельт нет (${ping.latencyMs}ms)`,
          watcherId: ping.watcherId,
          watcherTitle: title,
          statusCode: ping.statusCode,
          latencyMs: ping.latencyMs,
          itemsCount: ping.itemsFound,
          newItemsCount: 0,
          isProxyOnly: false,
          timestamp: ping.createdAt,
        };
      }

      this.addStoryItem(item);
      this.busRelay.emitWatcherPing(ping, neuron.config.slug);
      this.streamEvents$.next({
        id: `ping-${ping.id}`,
        type: 'watcher_ping',
        timestamp: ping.createdAt,
        category: neuron.config.category,
        watcherId: neuron.config.id,
        watcherSlug: neuron.config.slug,
        ping,
      });
    });

    neuron.deltaFlow$.subscribe((article) => {
      this.sse.broadcastArticle(article);
    });

    // Human-in-the-loop: raw news are saved to DB and emitted to reactive stream & bus bridge,
    // but NOT automatically converted to notes unless explicitly promoted by user
    neuron.rawNewsFlow$.subscribe((rawItem) => {
      this.busRelay.emitRawNewsCollected(rawItem);
      const streamItem = toStreamNewsItem(rawItem, {
        watcherSlug: neuron.config.slug,
        watcherTitle: neuron.config.title,
        category: neuron.config.category,
        feedSlug: neuron.config.feedSlug,
      });
      this.emitStreamNewsEvent({
        id: `news-${streamItem.id}-${Date.now()}`,
        type: 'news_item',
        timestamp: streamItem.createdAt,
        category: streamItem.category,
        watcherId: streamItem.watcherId,
        watcherSlug: streamItem.watcherSlug,
        item: streamItem,
      });
    });
  }

  private emitStreamNewsEvent(event: StreamLiveEvent): void {
    this.streamReplayBuffer.push(event);
    if (this.streamReplayBuffer.length > this.maxStreamReplaySize) {
      this.streamReplayBuffer.shift();
    }
    this.streamEvents$.next(event);
  }

  matchesStreamFilter(
    event: StreamLiveEvent,
    filter: { categories?: Set<string>; watchers?: Set<string>; types?: Set<string> }
  ): boolean {
    if (filter.types && filter.types.size > 0 && !filter.types.has(event.type)) {
      return false;
    }
    if (filter.categories && filter.categories.size > 0) {
      const cat = event.category || event.item?.category;
      if (!cat || !filter.categories.has(cat)) return false;
    }
    if (filter.watchers && filter.watchers.size > 0) {
      const wId = event.watcherId || event.item?.watcherId;
      const wSlug = event.watcherSlug || event.item?.watcherSlug;
      if ((!wId || !filter.watchers.has(wId)) && (!wSlug || !filter.watchers.has(wSlug))) {
        return false;
      }
    }
    return true;
  }

  getStreamReplay(options: {
    categories?: string[];
    watchers?: string[];
    types?: string[];
    limit?: number;
    sinceId?: string;
  } = {}): StreamLiveEvent[] {
    const filter = {
      categories: options.categories?.length ? new Set(options.categories) : undefined,
      watchers: options.watchers?.length ? new Set(options.watchers) : undefined,
      types: options.types?.length ? new Set(options.types) : undefined,
    };

    let events = this.streamReplayBuffer;
    if (options.sinceId) {
      const idx = events.findIndex((e) => e.id === options.sinceId);
      if (idx >= 0) {
        events = events.slice(idx + 1);
      }
    }

    const matched = events.filter((ev) => this.matchesStreamFilter(ev, filter));
    const limit = Math.min(Math.max(options.limit ?? 25, 0), 200);
    return limit > 0 ? matched.slice(-limit) : [];
  }

  async getStreamItems(options: StreamQueryOptions = {}): Promise<PaginatedStreamNews> {
    return this.db.getStreamItems(options);
  }

  async promoteStreamItem(
    id: string
  ): Promise<{ article: WatcherArticle; item: StreamNewsItem } | null> {
    const article = await this.converterQueue.convertById(id);
    if (!article) return null;

    await this.publishArticleToBus(article.id);
    const updatedArticle = (await this.db.getItemById(article.id)) || article;
    const raw = await this.db.getRawNewsById(id);
    const neuron = this.neurons.get(updatedArticle.watcherId);

    const streamItem: StreamNewsItem = raw
      ? toStreamNewsItem(raw, {
          watcherSlug: neuron?.config.slug,
          watcherTitle: neuron?.config.title,
          category: neuron?.config.category,
          feedSlug: neuron?.config.feedSlug,
        })
      : {
          id,
          watcherId: updatedArticle.watcherId,
          watcherSlug: updatedArticle.watcherSlug || neuron?.config.slug || updatedArticle.watcherId,
          watcherTitle: updatedArticle.watcherTitle || neuron?.config.title || 'Watcher',
          category: updatedArticle.category || neuron?.config.category || 'general',
          feedSlug: neuron?.config.feedSlug || `spark-${updatedArticle.category || 'general'}`,
          guid: updatedArticle.guid,
          url: updatedArticle.url,
          title: updatedArticle.title,
          teaser: updatedArticle.summary,
          imageUrl: updatedArticle.coverUrl || null,
          author: updatedArticle.author,
          pubDate: updatedArticle.publishedAt,
          categories: updatedArticle.tags || [],
          status: 'PROMOTED',
          noteId: updatedArticle.id,
          createdAt: updatedArticle.createdAt,
        };

    this.emitStreamNewsEvent({
      id: `promote-${id}-${Date.now()}`,
      type: 'news_promoted',
      timestamp: new Date().toISOString(),
      category: streamItem.category,
      watcherId: streamItem.watcherId,
      watcherSlug: streamItem.watcherSlug,
      item: streamItem,
      articleId: updatedArticle.id,
      noteId: updatedArticle.id,
    });

    return { article: updatedArticle, item: streamItem };
  }

  async promoteBatchStreamItems(
    ids: string[]
  ): Promise<{ count: number; articles: WatcherArticle[] }> {
    const articles: WatcherArticle[] = [];
    for (const id of ids) {
      const res = await this.promoteStreamItem(id);
      if (res) articles.push(res.article);
    }
    return { count: articles.length, articles };
  }

  async dismissStreamItems(
    ids: string[]
  ): Promise<{ count: number; items: StreamNewsItem[] }> {
    const dismissedRaw = await this.db.dismissRawNews(ids);
    const items: StreamNewsItem[] = [];

    for (const raw of dismissedRaw) {
      const neuron = this.neurons.get(raw.watcherId);
      const streamItem = toStreamNewsItem(raw, {
        watcherSlug: neuron?.config.slug,
        watcherTitle: neuron?.config.title,
        category: neuron?.config.category,
        feedSlug: neuron?.config.feedSlug,
      });
      items.push(streamItem);
      this.emitStreamNewsEvent({
        id: `dismiss-${streamItem.id}-${Date.now()}`,
        type: 'news_dismissed',
        timestamp: new Date().toISOString(),
        category: streamItem.category,
        watcherId: streamItem.watcherId,
        watcherSlug: streamItem.watcherSlug,
        item: streamItem,
        itemIds: [streamItem.id],
      });
    }

    return { count: items.length, items };
  }

  async pruneExpiredRawNews(ttlHours?: number): Promise<{ pruned: number; ttlHours: number }> {
    const hours = ttlHours && ttlHours > 0 ? ttlHours : this.config.rawNewsTtlHours;
    const pruned = await this.db.pruneExpiredRawNews(hours);
    if (pruned > 0) {
      console.log(`🧹 [WatchersEngine] Pruned ${pruned} expired raw news items (TTL: ${hours}h)`);
    }
    return { pruned, ttlHours: hours };
  }

  async getRawNews(options: {
    limit?: number;
    offset?: number;
    watcherId?: string;
    category?: string;
    status?: string;
    search?: string;
  } = {}): Promise<PaginatedRawNews> {
    return this.db.getRawNews(options);
  }

  async convertRawNews(id: string): Promise<WatcherArticle | null> {
    return this.converterQueue.convertById(id);
  }

  async convertBatchRawNews(ids: string[]): Promise<WatcherArticle[]> {
    const results: WatcherArticle[] = [];
    for (const id of ids) {
      const article = await this.converterQueue.convertById(id);
      if (article) {
        results.push(article);
      }
    }
    return results;
  }

  /** Бэкфилл: перевод выбранных старых статей на русский с сохранением оригинала в raw_payload. */
  async translateArticles(
    ids: string[]
  ): Promise<{ translated: WatcherArticle[]; failed: { id: string; error: string }[] }> {
    const translated: WatcherArticle[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of ids) {
      try {
        const article = await this.db.getItemById(id);
        if (!article) throw new Error('Not found');
        if (article.rawPayload?.translationStatus === 'translated') continue;
        const tr = await this.gemini.translateToRussian({
          title: article.title,
          summary: article.summary,
          content: article.content,
        });
        if (tr.sourceLanguage === 'ru') continue;
        const updated = await this.db.updateItemTranslation(id, {
          title: tr.titleRu,
          summary: tr.summaryRu,
          content: tr.contentRu,
          rawPayloadPatch: {
            // не затираем оригинал, если он уже был сохранён
            originalTitle: article.rawPayload?.originalTitle ?? article.title,
            originalSummary: article.rawPayload?.originalSummary ?? article.summary,
            originalContent: article.rawPayload?.originalContent ?? article.content,
            sourceLanguage: tr.sourceLanguage,
            translationStatus: 'translated',
          },
        });
        if (updated) translated.push(updated);
      } catch (err: any) {
        failed.push({ id, error: err?.message || String(err) });
      }
    }
    return { translated, failed };
  }

  async convertAndPublishBatchRawNews(ids: string[]): Promise<WatcherArticle[]> {
    const res = await this.promoteBatchStreamItems(ids);
    return res.articles;
  }

  async checkPendingRawNews(): Promise<number> {
    return this.converterQueue.checkPendingItems();
  }

  async generateArticleCover(
    id: string,
    options?: { prompt?: string; style?: string; aspectRatio?: ImageAspectRatio }
  ): Promise<WatcherArticle | null> {
    const article = await this.db.getItemById(id);
    if (!article) return null;

    const cover = await this.mediaCover.generateCoverForArticle({
      id: article.id,
      title: article.title,
      summary: article.summary,
      category: article.category,
      tags: article.tags,
      coverPrompt: options?.prompt || (article.rawPayload?.coverPrompt as string | undefined),
      style: options?.style,
      aspectRatio: options?.aspectRatio,
    });

    if (!cover) {
      throw new Error('Cover generation unavailable (check lemon-ai-service / lemon-media-hub)');
    }

    const updated = await this.db.updateItemCover(id, {
      coverUrl: cover.coverUrl,
      coverThumbnailUrl: cover.coverThumbnailUrl,
      coverAssetId: cover.coverAssetId,
      rawPayloadPatch: {
        coverUrl: cover.coverUrl,
        coverThumbnailUrl: cover.coverThumbnailUrl,
        coverAssetId: cover.coverAssetId,
        coverSource: cover.source || 'ai',
        coverPrompt: cover.synthesizedPrompt || options?.prompt,
        coverModel: cover.model,
      },
    });

    if (updated) {
      this.sse.broadcastArticle(updated);
      this.addStoryItem({
        id: `cover-${updated.id}-${Date.now()}`,
        type: 'NEWS_COLLECTED',
        title: `Media Hub: Обложка сгенерирована`,
        description: `Для «${updated.title}» создана обложка (${cover.model || 'ai-image'})`,
        watcherId: updated.watcherId,
        watcherTitle: updated.watcherTitle,
        isProxyOnly: false,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  /**
   * Loads the original cover from the news source (raw_news.imageUrl, HTML <img>, or article og:image)
   * and saves it into Lemon Media Hub via MediaLifecycleAxon (MediaIngestFlow + MediaViewFlow).
   */
  async fetchOriginalArticleCover(
    id: string,
    externalImageUrl?: string
  ): Promise<WatcherArticle | null> {
    const article = await this.db.getItemById(id);
    if (!article) return null;

    let candidateUrl =
      externalImageUrl ||
      (article.rawPayload?.originalCoverUrl as string | undefined) ||
      undefined;

    if (!candidateUrl && article.rawPayload?.rawNewsId) {
      const rawNews = await this.db.getRawNewsById(String(article.rawPayload.rawNewsId));
      if (rawNews) {
        candidateUrl =
          rawNews.imageUrl ||
          extractFirstImageFromHtml(rawNews.contentRaw || rawNews.description, rawNews.url || article.url);
      }
    }

    if (!candidateUrl) {
      candidateUrl = extractFirstImageFromHtml(article.content, article.url);
    }

    const cover = await this.mediaCover.resolveOriginalCover({
      id: article.id,
      title: article.title,
      category: article.category,
      tags: article.tags,
      externalImageUrl: candidateUrl,
      articleUrl: article.url,
    });

    if (!cover) {
      throw new Error('Original cover not found or could not be downloaded from news source');
    }

    const updated = await this.db.updateItemCover(id, {
      coverUrl: cover.coverUrl,
      coverThumbnailUrl: cover.coverThumbnailUrl,
      coverAssetId: cover.coverAssetId,
      rawPayloadPatch: {
        coverUrl: cover.coverUrl,
        coverThumbnailUrl: cover.coverThumbnailUrl,
        coverAssetId: cover.coverAssetId,
        coverSource: 'original',
        originalCoverUrl: cover.originalImageUrl || candidateUrl || null,
      },
    });

    if (updated) {
      this.sse.broadcastArticle(updated);
      this.addStoryItem({
        id: `orig-cover-${updated.id}-${Date.now()}`,
        type: 'NEWS_COLLECTED',
        title: `Media Hub: Оригинальная обложка сохранена`,
        description: `Загружена оригинальная обложка для «${updated.title}»`,
        watcherId: updated.watcherId,
        watcherTitle: updated.watcherTitle,
        isProxyOnly: false,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  /**
   * Loads an article's stored cover image via MediaLifecycleAxon.viewMedia (MediaViewFlow)
   * and streams it from Lemon Media Hub (or falls back to the stored coverUrl).
   */
  async loadArticleCover(
    id: string,
    variant?: string
  ): Promise<{ buffer: Buffer; contentType: string; assetId: string | null } | null> {
    const article = await this.db.getItemById(id);
    if (!article) return null;

    if (article.coverAssetId) {
      const streamed = await this.mediaCover.fetchCoverStream(article.coverAssetId, variant);
      if (streamed) {
        const arrayBuf = await streamed.response.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuf),
          contentType: streamed.contentType,
          assetId: article.coverAssetId,
        };
      }

      const view = await this.mediaCover.loadCoverView(article.coverAssetId, variant);
      if (view?.url) {
        const res = await fetch(view.url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuf),
            contentType: res.headers.get('content-type') || 'image/webp',
            assetId: article.coverAssetId,
          };
        }
      }
    }

    const fallbackUrl =
      variant === 'thumb'
        ? article.coverThumbnailUrl || article.coverUrl
        : article.coverUrl || article.coverThumbnailUrl;
    if (!fallbackUrl) return null;

    const resolvedUrl = this.mediaCover.resolveMediaUrl(fallbackUrl);
    if (!resolvedUrl) return null;

    const res = await fetch(resolvedUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuf),
      contentType: res.headers.get('content-type') || 'image/jpeg',
      assetId: article.coverAssetId || null,
    };
  }

  async assistArticleContent(
    id: string,
    options: { action?: AiAssistAction; instruction?: string }
  ): Promise<WatcherArticle | null> {
    const article = await this.db.getItemById(id);
    if (!article) return null;

    const assisted = await this.gemini.assistArticleContent({
      id: article.id,
      title: article.title,
      summary: article.summary,
      content: article.content,
      url: article.url,
      sourceTitle: article.watcherTitle || article.watcherSlug || 'Источник',
      eventDate: article.publishedAt,
      resonanceScore: article.resonanceScore,
      tags: article.tags,
      action: options.action || 'rewrite',
      instruction: options.instruction,
    });

    const updated = await this.db.updateItemAiAssist(id, {
      title: assisted.title,
      summary: assisted.summary,
      content: assisted.content,
      tags: assisted.tags,
      rawPayloadPatch: {
        coverPrompt: assisted.coverPrompt || article.rawPayload?.coverPrompt,
        aiAssistedBy: assisted.engine,
        aiAssistedAt: new Date().toISOString(),
      },
    });

    if (updated) {
      this.sse.broadcastArticle(updated);
      this.addStoryItem({
        id: `assist-${updated.id}-${Date.now()}`,
        type: 'NEWS_COLLECTED',
        title: `AI Помощник: Контент обновлён`,
        description: `Заметка «${updated.title}» доработана через ${assisted.engine}`,
        watcherId: updated.watcherId,
        watcherTitle: updated.watcherTitle,
        isProxyOnly: false,
        timestamp: new Date().toISOString(),
      });
    }

    return updated;
  }

  /**
   * Prepares an article for LemonBus:
   * keeps Russian articles as-is, and translates foreign-language articles to Russian
   * while preserving the English/original version inside metadata (rawPayload).
   */
  private async prepareArticleForBus(article: WatcherArticle): Promise<WatcherArticle> {
    const sourceLang = String(article.rawPayload?.sourceLanguage || '').toLowerCase();
    const trStatus = String(article.rawPayload?.translationStatus || '');

    if (sourceLang === 'ru' || trStatus === 'original-ru' || trStatus === 'translated') {
      return article;
    }

    try {
      const tr = await this.gemini.translateToRussian({
        title: article.title,
        summary: article.summary,
        content: article.content,
      });

      if (tr.sourceLanguage === 'ru') {
        return {
          ...article,
          rawPayload: {
            ...(article.rawPayload || {}),
            sourceLanguage: 'ru',
            translationStatus: 'original-ru',
          },
        };
      }

      return {
        ...article,
        title: tr.titleRu,
        summary: tr.summaryRu,
        content: tr.contentRu,
        rawPayload: {
          ...(article.rawPayload || {}),
          originalTitle: article.rawPayload?.originalTitle ?? article.title,
          originalSummary: article.rawPayload?.originalSummary ?? article.summary,
          originalContent: article.rawPayload?.originalContent ?? article.content,
          sourceLanguage: tr.sourceLanguage || sourceLang || 'en',
          translationStatus: 'translated',
        },
      };
    } catch (err: any) {
      console.warn(
        `[WatchersEngine] LemonBus translation fallback for "${article.title}": ${err?.message || err}`
      );
      return {
        ...article,
        rawPayload: {
          ...(article.rawPayload || {}),
          originalTitle: article.rawPayload?.originalTitle ?? article.title,
          originalSummary: article.rawPayload?.originalSummary ?? article.summary,
          originalContent: article.rawPayload?.originalContent ?? article.content,
          sourceLanguage: sourceLang || 'unknown',
        },
      };
    }
  }

  async publishArticleToBus(id: string): Promise<WatcherArticle | null> {
    const article = await this.db.getItemById(id);
    if (!article) return null;

    const busArticle = await this.prepareArticleForBus(article);
    await this.busRelay.publishArticleToBus(busArticle);
    const updated = await this.db.markItemPublishedToBus(id);

    this.addStoryItem({
      id: `bus-pub-${article.id}`,
      type: 'NEWS_COLLECTED',
      title: this.config.busModerationMode
        ? `LemonBus: Отправлено на модерацию`
        : `LemonBus: Опубликована заметка`,
      description: `Заметка «${busArticle.title}» (${article.watcherTitle || article.watcherId}) передана в LemonBus${this.config.busModerationMode ? ' (ожидает модерации)' : ''}`,
      watcherId: article.watcherId,
      watcherTitle: article.watcherTitle,
      isProxyOnly: false,
      timestamp: new Date().toISOString(),
    });

    return updated || article;
  }

  async publishPendingArticlesToBus(): Promise<{ count: number; articles: WatcherArticle[] }> {
    const pending = await this.db.getPendingBusArticles(50);
    const published: WatcherArticle[] = [];

    for (const article of pending) {
      const busArticle = await this.prepareArticleForBus(article);
      await this.busRelay.publishArticleToBus(busArticle);
      const updated = await this.db.markItemPublishedToBus(article.id);
      if (updated) published.push(updated);
    }

    if (published.length > 0) {
      this.addStoryItem({
        id: `bus-bulk-${Date.now()}`,
        type: 'NEWS_COLLECTED',
        title: `LemonBus: Пакетная публикация`,
        description: `Опубликовано ${published.length} заметок в шину LemonBus`,
        isProxyOnly: false,
        timestamp: new Date().toISOString(),
      });
    }

    return { count: published.length, articles: published };
  }

  async publishBatchArticlesToBus(ids: string[]): Promise<{ count: number; articles: WatcherArticle[] }> {
    const published: WatcherArticle[] = [];
    for (const id of ids) {
      const updated = await this.publishArticleToBus(id);
      if (updated) published.push(updated);
    }
    return { count: published.length, articles: published };
  }

  async getBusMetrics(): Promise<{
    busUrl: string;
    deviceId: string;
    activeSseSubscribers: number;
    total: number;
    published: number;
    pending: number;
  }> {
    const dbMetrics = await this.db.getBusMetrics();
    return {
      busUrl: this.config.lemonBusUrl,
      deviceId: this.config.deviceId,
      activeSseSubscribers: this.sse.count(),
      ...dbMetrics,
    };
  }

  async shutdown(): Promise<void> {
    console.log('🍋 [WatchersEngine] Shutting down Watcher Neurons...');
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.converterQueue.destroy();
    this.aiStudio?.stop();
    this.mediaHub?.stop();
    for (const neuron of this.neurons.values()) {
      neuron.stop();
    }
    this.streamEvents$.complete();
    this.sse.destroy();
    await this.db.close();
  }
}
