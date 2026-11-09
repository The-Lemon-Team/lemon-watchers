import { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { WatcherPingRecord, WatcherMetricsSnapshot } from '../types/ping.types.js';
import { SparkNotePayload } from '../types/note-payload.types.js';
import { WatcherArticle } from '../types/article.types.js';
import { StoryEvent } from '../types/story.types.js';
import { ProxyLogRecord } from '../axons/proxy-queue.axon.js';

interface SseClient {
  id: string;
  res: ServerResponse;
}

export class WatchersSseManager {
  private clients = new Map<string, SseClient>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast('heartbeat', { timestamp: new Date().toISOString() });
    }, 20000);
  }

  addClient(req: IncomingMessage, res: ServerResponse): string {
    const clientId = crypto.randomUUID();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

    this.clients.set(clientId, { id: clientId, res });

    req.on('close', () => {
      this.clients.delete(clientId);
    });

    return clientId;
  }

  broadcastPing(ping: WatcherPingRecord): void {
    this.broadcast('ping', ping);
  }

  broadcastArticle(article: WatcherArticle): void {
    this.broadcast('article', article);
    // Backward-compatibility alias
    this.broadcast('note', article);
  }

  broadcastNote(note: SparkNotePayload | WatcherArticle): void {
    this.broadcast('note', note);
  }

  broadcastMetrics(metrics: WatcherMetricsSnapshot): void {
    this.broadcast('metrics', metrics);
  }

  broadcastStory(story: StoryEvent): void {
    this.broadcast('story', story);
  }

  broadcastProxyLog(log: ProxyLogRecord): void {
    this.broadcast('proxy_log', log);
  }

  broadcastBusEnvelope(envelope: any): void {
    this.broadcast('bus_event', envelope);
  }

  count(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clients.values()) {
      client.res.end();
    }
    this.clients.clear();
  }

  private broadcast(event: string, data: any): void {
    if (this.clients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, client] of this.clients.entries()) {
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }
}
