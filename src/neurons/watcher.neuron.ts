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
import {
  CoreCombinatorClient,
  CompositeNeuronInstance,
  LeaseGuard,
} from '@lemon/core-combinator-sdk';

export interface WatcherNeuronDependencies {
  config: WatcherConfig;
  initialState: WatcherState;
  db: DatabaseService;
  gemini: GeminiSparkAxon;
  busRelay: BusRelayAxon;
  combinator?: CoreCombinatorClient;
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
  private readonly combinator?: CoreCombinatorClient;

  private scheduleSub: Subscription | null = null;
  private unsubscribeStream?: () => void;
  private isPolling = false;
  private compositeNeuron?: CompositeNeuronInstance;

  constructor(deps: WatcherNeuronDependencies) {
    this.config = deps.config;
    this.db = deps.db;
    this.gemini = deps.gemini;
    this.busRelay = deps.busRelay;
    this.combinator = deps.combinator;
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

  get composite(): CompositeNeuronInstance | undefined {
    return this.compositeNeuron;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;

    this.patchState({ enabled: true, status: 'IDLE' });

    if (this.combinator) {
      try {
        const sanitizedSlug = this.config.slug.replace(/[^a-zA-Z0-9_]/g, '_');
        this.compositeNeuron = await this.combinator.neurons.ensureCompositeNeuron({
          name: this.config.title,
          path: `watchers.news.${sanitizedSlug}`,
          flows: {
            context: {
              name: `${this.config.title} Context`,
              config: {
                url: this.config.url,
                protocol: this.config.protocol,
                category: this.config.category,
                etag: this.state.etag,
                lastModified: this.state.lastModified,
              },
            },
            circuitBreaker: {
              name: `${this.config.title} Circuit Breaker`,
              failureThreshold: 3,
              cooldownSeconds: 60,
            },
            timer: {
              name: `${this.config.title} Pulse Timer`,
              intervalSeconds: this.config.pollIntervalSeconds || 120,
            },
            mutex: {
              name: `${this.config.title} Mutex Lease`,
              isExclusive: true,
              leaseTimeoutSeconds: 60,
              onConflict: 'queue',
              gate: {
                requireCircuitBreaker: 'CLOSED',
              },
            },
            batch: {
              name: `${this.config.title} Influx Batch`,
              maxBatchSize: 10,
              idleTimeoutSeconds: 15,
            },
            observer: {
              name: `${this.config.title} Telemetry`,
            },
          },
        });

        console.log(
          `🧠 [WatcherNeuron:${this.config.slug}] Registered composite neuron in Core Combinator (ID: ${this.compositeNeuron.neuron.id})`
        );

        // Subscribe to TIMER_TICK impulses from Core Combinator
        if (this.compositeNeuron.flows.timer) {
          this.unsubscribeStream = this.combinator.stream.subscribe(
            {
              folderId: this.compositeNeuron.neuron.id,
              impulseType: 'TIMER_TICK',
            },
            (packet) => {
              console.log(
                `⏱️ [WatcherNeuron:${this.config.slug}] Received TIMER_TICK from Core Combinator`
              );
              this.poll().catch((err) => {
                console.error(
                  `[WatcherNeuron:${this.config.slug}] Stream poll error:`,
                  err?.message || err
                );
              });
            }
          );
        }
      } catch (err: any) {
        console.warn(
          `⚠️ [WatcherNeuron:${this.config.slug}] Could not bind Core Combinator, falling back to local scheduler:`,
          err?.message || err
        );
      }
    }

    // Fallback or complementary local scheduler
    if (!this.unsubscribeStream) {
      this.scheduleSub = this.scheduler.triggers$().subscribe(() => {
        this.poll().catch((err) => {
          console.error(
            `[WatcherNeuron:${this.config.slug}] Scheduled poll error:`,
            err?.message || err
          );
        });
      });
    }
  }

  stop(): void {
    if (this.scheduleSub) {
      this.scheduleSub.unsubscribe();
      this.scheduleSub = null;
    }
    if (this.unsubscribeStream) {
      this.unsubscribeStream();
      this.unsubscribeStream = undefined;
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

    // 1. Acquire Lease from Core Combinator Mutex (guarded by BARRIER Gate)
    let leaseGuard: LeaseGuard | null = null;
    if (this.combinator && this.compositeNeuron?.flows?.mutex) {
      try {
        leaseGuard = await this.combinator.acquireLease(this.compositeNeuron.flows.mutex.id, {
          leaseTimeoutSeconds: 60,
          heartbeatIntervalSec: 15,
        });
      } catch (err: any) {
        console.warn(
          `🛑 [WatcherNeuron:${this.config.slug}] Lease rejected by Core Combinator (Barrier Gate):`,
          err?.message || err
        );
        return {
          id: 'gate-blocked',
          watcherId: this.config.id,
          statusCode: 423, // Locked
          latencyMs: 0,
          itemsFound: 0,
          newItemsCount: 0,
          error: `Core Combinator Gate blocked: ${err?.message || err}`,
          createdAt: new Date().toISOString(),
        };
      }
    }

    this.isPolling = true;
    this.patchState({ status: 'POLLING' });

    try {
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
        if (this.combinator && this.compositeNeuron?.flows?.circuitBreaker) {
          await this.combinator.chronicle
            .recordSuccess(this.compositeNeuron.flows.circuitBreaker.id, { statusCode: 304 })
            .catch(() => {});
        }
        if (this.combinator && this.compositeNeuron?.flows?.observer) {
          await this.combinator.chronicle
            .recordMetric(this.compositeNeuron.flows.observer.id, 'latency', fetchRes.latencyMs, { statusCode: 304 })
            .catch(() => {});
        }

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
        return ping;
      }

      // 2. Handle HTTP Errors or Network Failures
      if (fetchRes.error || fetchRes.statusCode >= 400) {
        const errorMsg = fetchRes.error || `HTTP ${fetchRes.statusCode}`;

        if (this.combinator && this.compositeNeuron?.flows?.circuitBreaker) {
          await this.combinator.chronicle
            .recordFailure(this.compositeNeuron.flows.circuitBreaker.id, errorMsg, {
              statusCode: fetchRes.statusCode,
            })
            .catch(() => {});
        }
        if (this.combinator && this.compositeNeuron?.flows?.observer) {
          await this.combinator.chronicle
            .recordMetric(this.compositeNeuron.flows.observer.id, 'failure', 1, {
              statusCode: fetchRes.statusCode,
              error: errorMsg,
            })
            .catch(() => {});
        }

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

        // Push new items into Core Combinator BATCH flow
        if (this.combinator && this.compositeNeuron?.flows?.batch) {
          const batchItems = deltaItems.map((d) => ({
            payload: {
              guid: d.raw.guid,
              url: d.raw.url,
              title: d.raw.title,
              summary: d.raw.summary,
              pubDate: d.raw.pubDate,
              watcherId: this.config.id,
              category: this.config.category,
            },
            dedupKey: d.raw.guid,
          }));

          await this.combinator.batch
            .pushMany(this.compositeNeuron.flows.batch.id, batchItems)
            .catch((err) => {
              console.warn(
                `[WatcherNeuron:${this.config.slug}] Failed to push items to BATCH flow:`,
                err?.message || err
              );
            });
        }
      }

      // 4. Record Successful Ping & Update State
      if (this.combinator && this.compositeNeuron?.flows?.circuitBreaker) {
        await this.combinator.chronicle
          .recordSuccess(this.compositeNeuron.flows.circuitBreaker.id, {
            statusCode: fetchRes.statusCode,
            itemsFound: items.length,
            newItems: processedNotesCount,
          })
          .catch(() => {});
      }
      if (this.combinator && this.compositeNeuron?.flows?.observer) {
        await this.combinator.chronicle
          .recordMetric(this.compositeNeuron.flows.observer.id, 'latency', fetchRes.latencyMs, {
            newItems: processedNotesCount,
          })
          .catch(() => {});
      }

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
      return ping;
    } finally {
      if (leaseGuard) {
        await leaseGuard.release('watcher-poll-finished').catch(() => {});
      }
      this.isPolling = false;
    }
  }

  private patchState(patch: Partial<WatcherState>): void {
    this.state$.next({
      ...this.state$.getValue(),
      ...patch,
    });
  }
}
