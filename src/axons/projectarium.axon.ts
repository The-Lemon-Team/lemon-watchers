export interface ProjectariumAxonOptions {
  baseUrl: string;
  appName?: string;
  projectSlug?: string;
  projectName?: string;
  preferredPort: number;
  role?: string;
  icon?: string;
  healthUrl?: string;
  environment?: 'dev' | 'staging' | 'production';
  networkMode?: 'local' | 'lan' | 'tailscale-lan' | 'tailscale-funnel';
  enabled?: boolean;
  heartbeatIntervalMs?: number;
}

export interface ProjectariumRegistration {
  instanceId: string;
  leaseToken: string;
  port: number;
  projectToken?: string;
}

/**
 * Registers the Lemon-Watchers service on the shared Projectarium / Port Shield stand,
 * maintains lease heartbeats, and releases the instance gracefully on shutdown.
 */
export class ProjectariumAxon {
  private readonly baseUrl: string;
  private readonly appName: string;
  private readonly projectSlug: string;
  private readonly projectName: string;
  private readonly preferredPort: number;
  private readonly role: string;
  private readonly icon: string;
  private readonly healthUrl: string;
  private readonly environment: 'dev' | 'staging' | 'production';
  private readonly networkMode: 'local' | 'lan' | 'tailscale-lan' | 'tailscale-funnel';
  private readonly enabled: boolean;
  private readonly heartbeatIntervalMs: number;

  private registration: ProjectariumRegistration | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: ProjectariumAxonOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.appName = options.appName || 'lemon-watchers-api';
    this.projectSlug = options.projectSlug || 'lemon-watchers';
    this.projectName = options.projectName || 'Lemon Watchers';
    this.preferredPort = options.preferredPort;
    this.role = options.role || 'Reactive News Watchers API & Dashboard';
    this.icon = options.icon || 'visibility';
    this.healthUrl = options.healthUrl || `http://localhost:${this.preferredPort}/health`;
    this.environment = options.environment || 'dev';
    this.networkMode = options.networkMode || 'local';
    this.enabled = options.enabled !== false;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
  }

  get currentRegistration(): ProjectariumRegistration | null {
    return this.registration;
  }

  private async cleanupExistingInstances(): Promise<void> {
    try {
      const res = await fetch(
        `${this.baseUrl}/projectarium/projects/${encodeURIComponent(this.projectSlug)}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (!res.ok) return;

      const project = (await res.json()) as any;
      const apps: any[] = Array.isArray(project?.apps) ? project.apps : [];
      const stale = apps.filter(
        (a) =>
          a.appName === this.appName &&
          (a.networkMode || 'local') === this.networkMode &&
          a.instanceId &&
          a.leaseToken
      );

      for (const app of stale) {
        try {
          await fetch(`${this.baseUrl}/projectarium/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instanceId: app.instanceId,
              leaseToken: app.leaseToken,
              author: 'lemon-watchers',
            }),
            signal: AbortSignal.timeout(2500),
          });
        } catch {
          // Ignore individual cleanup errors
        }
      }
    } catch {
      // Best-effort cleanup before registering
    }
  }

  async register(): Promise<ProjectariumRegistration | null> {
    if (!this.enabled) return null;

    await this.cleanupExistingInstances();

    try {
      const res = await fetch(`${this.baseUrl}/projectarium/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectSlug: this.projectSlug,
          projectName: this.projectName,
          appName: this.appName,
          host: 'localhost',
          role: this.role,
          icon: this.icon,
          preferredPort: this.preferredPort,
          environment: this.environment,
          networkMode: this.networkMode,
          healthUrl: this.healthUrl,
          author: 'lemon-watchers',
        }),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        console.warn(
          `⚠️ [ProjectariumAxon] Registration returned HTTP ${res.status}: ${await res.text()}`
        );
        return null;
      }

      const data = (await res.json()) as any;
      const app = data.allocatedApp || data.app;
      if (!app?.instanceId || !app?.leaseToken) {
        return null;
      }

      this.registration = {
        instanceId: app.instanceId,
        leaseToken: app.leaseToken,
        port: typeof app.port === 'number' ? app.port : this.preferredPort,
        projectToken: data.project?.projectToken,
      };

      console.log(
        `🛡️ [ProjectariumAxon] Registered ${this.appName} on stand "${this.projectSlug}" (port: ${this.registration.port}, instance: ${this.registration.instanceId})`
      );

      this.startHeartbeat();
      return this.registration;
    } catch (err: any) {
      console.warn(
        `⚠️ [ProjectariumAxon] Projectarium unavailable (${this.baseUrl}): ${err?.message || err}`
      );
      return null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.registration) return;

    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.registration) return;
    try {
      await fetch(`${this.baseUrl}/projectarium/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: this.registration.instanceId,
          leaseToken: this.registration.leaseToken,
        }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Best-effort heartbeat; Projectarium probe handles transient drops
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async release(): Promise<void> {
    this.stopHeartbeat();
    if (!this.registration) return;

    const reg = this.registration;
    this.registration = null;

    try {
      await fetch(`${this.baseUrl}/projectarium/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: reg.instanceId,
          leaseToken: reg.leaseToken,
          author: 'lemon-watchers',
        }),
        signal: AbortSignal.timeout(3000),
      });
      console.log(`🛡️ [ProjectariumAxon] Released lease ${reg.instanceId}`);
    } catch {
      // Best-effort release on shutdown
    }
  }
}
