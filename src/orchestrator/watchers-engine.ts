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
import { CoreCombinatorClient } from '@lemon/core-combinator-sdk';
import { AiStudioAxon, ImageAspectRatio } from '@lemon/ai-neurons';
import { MediaLifecycleAxon } from '@lemon/media-hub-neurons';
import { MediaCoverAxon } from '../axons/media-cover.axon.js';
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
  private readonly converterQueue: NewsConverterQueueAxon;
  private readonly storyBuffer: StoryEvent[] = [];

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
      enabled: config.enableCoverGeneration,
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
    });

    neuron.deltaFlow$.subscribe((article) => {
      this.sse.broadcastArticle(article);
    });

    // Human-in-the-loop: raw news are saved to DB and emitted to bus bridge,
    // but NOT automatically converted to notes unless explicitly triggered by user
    neuron.rawNewsFlow$.subscribe((rawItem) => {
      this.busRelay.emitRawNewsCollected(rawItem);
    });
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
    const results: WatcherArticle[] = [];
    for (const id of ids) {
      const article = await this.converterQueue.convertById(id);
      if (article) {
        await this.publishArticleToBus(article.id);
        const updated = await this.db.getItemById(article.id);
        results.push(updated || article);
      }
    }
    return results;
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

  async publishArticleToBus(id: string): Promise<WatcherArticle | null> {
    const article = await this.db.getItemById(id);
    if (!article) return null;

    await this.busRelay.publishArticleToBus(article);
    const updated = await this.db.markItemPublishedToBus(id);

    this.addStoryItem({
      id: `bus-pub-${article.id}`,
      type: 'NEWS_COLLECTED',
      title: this.config.busModerationMode
        ? `LemonBus: Отправлено на модерацию`
        : `LemonBus: Опубликована заметка`,
      description: `Заметка «${article.title}» (${article.watcherTitle || article.watcherId}) передана в LemonBus${this.config.busModerationMode ? ' (ожидает модерации)' : ''}`,
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
      await this.busRelay.publishArticleToBus(article);
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
    this.converterQueue.destroy();
    this.aiStudio?.stop();
    this.mediaHub?.stop();
    for (const neuron of this.neurons.values()) {
      neuron.stop();
    }
    this.sse.destroy();
    await this.db.close();
  }
}
