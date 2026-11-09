import { Observable, Subject, Subscription, timer, merge } from 'rxjs';

export interface SchedulingNeuronOptions {
  intervalSeconds: number;
  initialDelaySeconds?: number;
  enableJitter?: boolean;
}

export class SchedulingNeuron {
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly enableJitter: boolean;

  private manualTrigger$ = new Subject<void>();
  private activeSub: Subscription | null = null;
  private isPaused = false;

  constructor(options: SchedulingNeuronOptions) {
    this.intervalMs = Math.max(10, options.intervalSeconds) * 1000;
    this.initialDelayMs = (options.initialDelaySeconds || 0) * 1000;
    this.enableJitter = options.enableJitter !== false;
  }

  /**
   * Returns an Observable of scheduled trigger events.
   */
  triggers$(): Observable<void> {
    const jitter = this.enableJitter ? Math.floor(Math.random() * 5000) : 0;
    const initialDue = this.initialDelayMs + jitter;

    const periodic$ = new Observable<void>((subscriber) => {
      let timeoutId: NodeJS.Timeout | null = null;

      const scheduleNext = (delay: number) => {
        timeoutId = setTimeout(() => {
          if (!this.isPaused) {
            subscriber.next();
          }
          const nextJitter = this.enableJitter
            ? Math.floor(Math.random() * 10000) - 5000
            : 0;
          const nextDelay = Math.max(5000, this.intervalMs + nextJitter);
          scheduleNext(nextDelay);
        }, delay);
      };

      scheduleNext(initialDue);

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
      };
    });

    return merge(periodic$, this.manualTrigger$);
  }

  triggerNow(): void {
    this.manualTrigger$.next();
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  destroy(): void {
    if (this.activeSub) {
      this.activeSub.unsubscribe();
      this.activeSub = null;
    }
    this.manualTrigger$.complete();
  }
}
