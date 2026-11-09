import crypto from 'node:crypto';
import { Subject } from 'rxjs';
import { WatcherArticle } from '../types/article.types.js';
import { RawNewsItem } from '../types/raw-news.types.js';
import { WatcherPingRecord } from '../types/ping.types.js';

export interface BusEventEnvelope {
  eventId: string;
  timestamp: string;
  source: string;
  entityType: 'NOTE' | 'WATCHER_RAW_NEWS' | 'WATCHER_ARTICLE' | 'WATCHER_PING' | string;
  action: 'UPSERT' | 'COLLECTED' | 'CONVERTED' | 'PUBLISHED' | string;
  feedSlug?: string;
  category: string;
  watcherSlug: string;
  deviceId: string;
  payload: Record<string, any>;
}

export class BusRelayAxon {
  private readonly busUrl: string;
  private readonly deviceId: string;
  public readonly busEvents$ = new Subject<BusEventEnvelope>();

  constructor(options: { busUrl: string; deviceId: string }) {
    this.busUrl = options.busUrl.replace(/\/+$/, '');
    this.deviceId = options.deviceId;
  }

  /**
   * Emits a pure autonomous collected item into the reactive LemonBus bridge.
   * Formatted as a LemonBus Note payload so downstream subscribers (like Lemon Seasons)
   * can seamlessly consume and display the note in their UI.
   */
  async publishArticleToBus(item: WatcherArticle): Promise<boolean> {
    const eventId = crypto.randomUUID();
    const feedSlug = `spark-${item.category || 'general'}`;
    const envelope: BusEventEnvelope = {
      eventId,
      timestamp: new Date().toISOString(),
      source: 'lemon-watchers',
      entityType: 'NOTE',
      action: 'UPSERT',
      feedSlug,
      category: item.category || 'general',
      watcherSlug: item.watcherSlug || item.watcherId,
      deviceId: this.deviceId,
      payload: {
        id: item.id,
        title: item.title,
        description: item.summary,
        rawContent: item.content,
        summary: item.summary,
        folderPath: `Spark/${item.category || 'general'}`,
        status: 'PUBLISHED',
        privacy: 'public',
        feedSlug,
        publicFeedId: feedSlug,
        type: 'SINGLE',
        startDate: item.publishedAt,
        sourceLink: item.url,
        sourceType: 'LEMON_WATCHERS',
        origin: 'CODING_AGENT',
        provenance: {
          origin: 'CODING_AGENT',
          transportVia: 'cloud',
          deviceId: this.deviceId,
        },
        author: item.author || item.watcherTitle || 'Lemon Watchers',
        resonanceScore: item.resonanceScore,
        icon: '📰',
        hashtags: item.tags,
        metadata: {
          guid: item.guid,
          watcherSlug: item.watcherSlug,
          watcherTitle: item.watcherTitle,
          category: item.category,
          ...(item.rawPayload || {}),
        },
      },
    };

    // 1. Reactive emission for SSE bridge subscribers
    this.busEvents$.next(envelope);

    // 2. HTTP POST forward to external LemonBus endpoint (if available)
    try {
      const res = await fetch(`${this.busUrl}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': this.deviceId,
        },
        body: JSON.stringify(envelope),
      });

      if (!res.ok) {
        console.warn(
          `[BusRelayAxon] LemonBus publish returned ${res.status}: ${res.statusText}`
        );
        return false;
      }
      return true;
    } catch (err: any) {
      console.warn(
        `[BusRelayAxon] LemonBus endpoint unreachable (${this.busUrl}): ${err.message}. Event emitted locally to SSE bridge.`
      );
      return false;
    }
  }

  /**
   * Notifies the reactive bridge when raw news are ingested
   */
  emitRawNewsCollected(item: RawNewsItem): void {
    const envelope: BusEventEnvelope = {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source: 'lemon-watchers',
      entityType: 'WATCHER_RAW_NEWS',
      action: 'COLLECTED',
      category: item.category || 'general',
      watcherSlug: item.watcherSlug || item.watcherId,
      deviceId: this.deviceId,
      payload: {
        id: item.id,
        watcherId: item.watcherId,
        watcherSlug: item.watcherSlug,
        watcherTitle: item.watcherTitle,
        category: item.category,
        guid: item.guid,
        url: item.url,
        title: item.title,
        description: item.description,
        author: item.author,
        pubDate: item.pubDate,
        categories: item.categories,
        status: item.status,
      },
    };
    this.busEvents$.next(envelope);
  }

  /**
   * Notifies the reactive bridge when telemetry ping occurs
   */
  emitWatcherPing(ping: WatcherPingRecord, watcherSlug: string): void {
    const envelope: BusEventEnvelope = {
      eventId: ping.id,
      timestamp: ping.createdAt,
      source: 'lemon-watchers',
      entityType: 'WATCHER_PING',
      action: 'COLLECTED',
      category: 'telemetry',
      watcherSlug,
      deviceId: this.deviceId,
      payload: {
        ...ping,
      },
    };
    this.busEvents$.next(envelope);
  }
}
