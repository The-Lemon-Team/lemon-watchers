import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import {
  WatcherConfig,
  WatcherState,
  RawFeedItem,
} from '../types/watcher.types.js';
import { WatcherPingRecord } from '../types/ping.types.js';
import { SparkNotePayload } from '../types/note-payload.types.js';
import { WatcherArticle } from '../types/article.types.js';
import { RawNewsItem } from '../types/raw-news.types.js';
import { DatabaseService } from '../db/database.service.js';
import { fetchFeedItems } from '../axons/rss-atom-fetcher.axon.js';
import { DeltaDetectorNeuron } from './delta-detector.neuron.js';
import { GeminiSparkAxon } from '../axons/gemini-spark.axon.js';
import { BusRelayAxon } from '../axons/bus-relay.axon.js';
import { SchedulingNeuron } from './scheduling.neuron.js';

export interface WatcherNeuronDependencies {
  config: WatcherConfig;
  initialState: WatcherState;
  db: DatabaseService;
  gemini: GeminiSparkAxon;
  busRelay: BusRelayAxon;
  initialDelaySeconds?: number;
}

export class WatcherNeuron {
  public readonly config: WatcherConfig;
  public readonly state$: BehaviorSubject<WatcherState>;
  public readonly pingFlow$ = new Subject<WatcherPingRecord>();
  public readonly deltaFlow$ = new Subject<WatcherArticle>();
  public readonly rawNewsFlow$ = new Subject<RawNewsItem>();

  private readonly db: DatabaseService;
  private readonly gemini: GeminiSparkAxon;
  private readonly busRelay: BusRelayAxon;
  private readonly deltaDetector: DeltaDetectorNeuron;
  private readonly scheduler: SchedulingNeuron;

  private scheduleSub: Subscription | null = null;
  private isPolling = false;

  constructor(deps: WatcherNeuronDependencies) {
    this.config = deps.config;
    this.db = deps.db;
    this.gemini = deps.gemini;
    this.busRelay = deps.busRelay;
    this.deltaDetector = new DeltaDetectorNeuron(this.db);

    this.state$ = new BehaviorSubject<WatcherState>(deps.initialState);

    this.scheduler = new SchedulingNeuron({
      intervalSeconds: this.config.pollIntervalSeconds,
      initialDelaySeconds: deps.initialDelaySeconds ?? 2,
      enableJitter: true,
    });
  }

  get state(): WatcherState {
    return this.state$.getValue();
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;

    this.patchState({ enabled: true, status: 'IDLE' });

    this.scheduleSub = this.scheduler.triggers$().subscribe(() => {
      this.poll().catch((err) => {
        console.error(
          `[WatcherNeuron:${this.config.slug}] Scheduled poll error:`,
          err?.message || err
        );
      });
    });
  }

  stop(): void {
    if (this.scheduleSub) {
      this.scheduleSub.unsubscribe();
      this.scheduleSub = null;
    }
    this.scheduler.destroy();
    this.patchState({ status: 'PAUSED', enabled: false });
  }

  triggerManualPoll(): void {
    this.scheduler.triggerNow();
  }

  async poll(force = false): Promise<WatcherPingRecord> {
    if (!this.config.enabled && !force) {
      return {
        id: 'disabled',
        watcherId: this.config.id,
        statusCode: 409,
        latencyMs: 0,
        itemsFound: 0,
        newItemsCount: 0,
        error: 'Watcher is paused (Mutex Guard inactive)',
        createdAt: new Date().toISOString(),
      };
    }

    if (this.isPolling) {
      return {
        id: 'in-progress',
        watcherId: this.config.id,
        statusCode: 429,
        latencyMs: 0,
        itemsFound: 0,
        newItemsCount: 0,
        error: 'Poll already in progress',
        createdAt: new Date().toISOString(),
      };
    }

    this.isPolling = true;
    this.patchState({ status: 'POLLING' });

    const currentState = this.state;
    const fetchRes = await fetchFeedItems({
      url: this.config.url,
      protocol: this.config.protocol,
      etag: currentState.etag,
      lastModified: currentState.lastModified,
    });

    const now = new Date().toISOString();

    // 1. Handle HTTP 304 Not Modified
    if (fetchRes.notModified) {
      const ping = await this.db.recordPing({
        watcherId: this.config.id,
        statusCode: 304,
        latencyMs: fetchRes.latencyMs,
        itemsFound: 0,
        newItemsCount: 0,
      });

      this.patchState({
        status: 'SUCCESS',
        lastPingAt: now,
        lastSuccessAt: now,
        lastError: null,
        consecutiveFailures: 0,
        totalPings: currentState.totalPings + 1,
        lastLatencyMs: fetchRes.latencyMs,
      });

      await this.db.updateWatcherState(this.config.id, {
        status: 'SUCCESS',
        lastPingAt: now,
        lastSuccessAt: now,
        lastError: null,
        consecutiveFailures: 0,
        totalPingsIncrement: 1,
        lastLatencyMs: fetchRes.latencyMs,
      });

      this.pingFlow$.next(ping);
      this.isPolling = false;
      return ping;
    }

    // 2. Handle HTTP Errors or Network Failures
    if (fetchRes.error || fetchRes.statusCode >= 400) {
      const errorMsg = fetchRes.error || `HTTP ${fetchRes.statusCode}`;
      const ping = await this.db.recordPing({
        watcherId: this.config.id,
        statusCode: fetchRes.statusCode,
        latencyMs: fetchRes.latencyMs,
        itemsFound: 0,
        newItemsCount: 0,
        error: errorMsg,
      });

      const failures = currentState.consecutiveFailures + 1;
      this.patchState({
        status: 'ERROR',
        lastPingAt: now,
        lastError: errorMsg,
        consecutiveFailures: failures,
        totalPings: currentState.totalPings + 1,
        lastLatencyMs: fetchRes.latencyMs,
      });

      await this.db.updateWatcherState(this.config.id, {
        status: 'ERROR',
        lastPingAt: now,
        lastError: errorMsg,
        consecutiveFailures: failures,
        totalPingsIncrement: 1,
        lastLatencyMs: fetchRes.latencyMs,
      });

      this.pingFlow$.next(ping);
      this.isPolling = false;
      return ping;
    }

    // 3. Process Feed Items and Detect Deltas
    const items = fetchRes.items || [];
    const deltaItems = await this.deltaDetector.detectNewItems(
      this.config.id,
      items
    );

    let processedNotesCount = 0;

    if (deltaItems.length > 0) {
      this.patchState({ status: 'PROCESSING' });

      for (const delta of deltaItems) {
        try {
          const inserted = await this.db.insertRawNews({
            watcherId: this.config.id,
            guid: delta.raw.guid,
            url: delta.raw.url,
            title: delta.raw.title,
            description: delta.raw.summary || '',
            contentRaw: delta.raw.rawText || delta.raw.contentHtml || delta.raw.summary || '',
            author: delta.raw.author || this.config.title,
            pubDate: delta.raw.pubDate || new Date().toISOString(),
            categories: delta.raw.categories || [],
            contentHash: delta.contentHash,
          });

          if (inserted) {
            processedNotesCount++;
            this.rawNewsFlow$.next(inserted);
          }
        } catch (err: any) {
          console.error(
            `[WatcherNeuron:${this.config.slug}] Error storing raw news ${delta.raw.guid}:`,
            err?.message || err
          );
        }
      }
    }

    // 4. Record Successful Ping & Update State
    const ping = await this.db.recordPing({
      watcherId: this.config.id,
      statusCode: fetchRes.statusCode,
      latencyMs: fetchRes.latencyMs,
      itemsFound: items.length,
      newItemsCount: processedNotesCount,
      error: null,
    });

    this.patchState({
      status: 'SUCCESS',
      lastPingAt: now,
      lastSuccessAt: now,
      lastError: null,
      etag: fetchRes.etag || currentState.etag,
      lastModified: fetchRes.lastModified || currentState.lastModified,
      consecutiveFailures: 0,
      totalPings: currentState.totalPings + 1,
      totalItemsIngested: currentState.totalItemsIngested + processedNotesCount,
      lastLatencyMs: fetchRes.latencyMs,
    });

    await this.db.updateWatcherState(this.config.id, {
      status: 'SUCCESS',
      lastPingAt: now,
      lastSuccessAt: now,
      lastError: null,
      etag: fetchRes.etag || currentState.etag,
      lastModified: fetchRes.lastModified || currentState.lastModified,
      consecutiveFailures: 0,
      totalPingsIncrement: 1,
      totalItemsIngestedIncrement: processedNotesCount,
      lastLatencyMs: fetchRes.latencyMs,
    });

    this.pingFlow$.next(ping);
    this.isPolling = false;
    return ping;
  }

  private patchState(patch: Partial<WatcherState>): void {
    this.state$.next({
      ...this.state$.getValue(),
      ...patch,
    });
  }
}
