import { Subject, mergeMap } from 'rxjs';
import crypto from 'node:crypto';

export interface ProxyLogRecord {
  id: string;
  url: string;
  protocol: string;
  stage: 'ENQUEUED' | 'FETCHING' | 'SUCCESS' | 'ERROR';
  statusCode?: number;
  latencyMs?: number;
  error?: string | null;
  timestamp: string;
}

interface ProxyTask<T> {
  id: string;
  url: string;
  protocol: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  queuedAt: number;
}

export class ProxyRequestQueue {
  private readonly queue$ = new Subject<ProxyTask<any>>();
  public readonly proxyLogs$ = new Subject<ProxyLogRecord>();
  private readonly recentLogs: ProxyLogRecord[] = [];
  private activeCount = 0;
  private waitingCount = 0;

  constructor(
    private readonly maxConcurrency: number = 2,
    private readonly delayBetweenMs: number = 150
  ) {
    this.initPipeline();
  }

  private initPipeline(): void {
    this.queue$
      .pipe(
        mergeMap(async (task) => {
          this.waitingCount--;
          this.activeCount++;

          this.emitLog({
            id: task.id,
            url: task.url,
            protocol: task.protocol,
            stage: 'FETCHING',
            timestamp: new Date().toISOString(),
          });

          const startTime = Date.now();
          try {
            if (this.delayBetweenMs > 0) {
              await new Promise((r) => setTimeout(r, this.delayBetweenMs));
            }
            const res: any = await task.fn();
            const latencyMs = Date.now() - startTime;

            this.emitLog({
              id: task.id,
              url: task.url,
              protocol: task.protocol,
              stage: res && res.error ? 'ERROR' : 'SUCCESS',
              statusCode: res?.statusCode ?? 200,
              latencyMs: res?.latencyMs ?? latencyMs,
              error: res?.error ?? null,
              timestamp: new Date().toISOString(),
            });

            task.resolve(res);
          } catch (err: any) {
            this.emitLog({
              id: task.id,
              url: task.url,
              protocol: task.protocol,
              stage: 'ERROR',
              statusCode: 500,
              latencyMs: Date.now() - startTime,
              error: err?.message || 'Proxy fetch failed',
              timestamp: new Date().toISOString(),
            });
            task.reject(err);
          } finally {
            this.activeCount--;
          }
        }, this.maxConcurrency)
      )
      .subscribe();
  }

  private emitLog(log: ProxyLogRecord): void {
    this.recentLogs.unshift(log);
    if (this.recentLogs.length > 100) {
      this.recentLogs.pop();
    }
    this.proxyLogs$.next(log);
  }

  /**
   * Pushes a fetch request into the controlled proxy queue.
   */
  enqueue<T>(meta: { url: string; protocol: string }, fn: () => Promise<T>): Promise<T> {
    this.waitingCount++;
    const id = crypto.randomUUID();

    this.emitLog({
      id,
      url: meta.url,
      protocol: meta.protocol,
      stage: 'ENQUEUED',
      timestamp: new Date().toISOString(),
    });

    return new Promise<T>((resolve, reject) => {
      this.queue$.next({
        id,
        url: meta.url,
        protocol: meta.protocol,
        fn,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
    });
  }

  getRecentLogs(): ProxyLogRecord[] {
    return [...this.recentLogs];
  }

  get stats() {
    return {
      active: this.activeCount,
      waiting: Math.max(0, this.waitingCount),
      maxConcurrency: this.maxConcurrency,
    };
  }
}

// Global proxy queue: max 2 concurrent requests, 150ms delay between requests
export const proxyQueue = new ProxyRequestQueue(2, 150);
