import pg from 'pg';
import crypto from 'node:crypto';
import { WatcherConfig, WatcherState, WatcherFolder } from '../types/watcher.types.js';
import { WatcherPingRecord, WatcherMetricsSnapshot } from '../types/ping.types.js';
import { WatcherArticle, WatcherArticleQueryOptions, PaginatedArticles } from '../types/article.types.js';
import { RawNewsItem, RawNewsStatus, PaginatedRawNews } from '../types/raw-news.types.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS lemon_watcher_folders (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(128) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT DEFAULT '',
  icon VARCHAR(32) NOT NULL DEFAULT '📁',
  color VARCHAR(32) NOT NULL DEFAULT '#eab308',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lemon_watcher_folders_slug ON lemon_watcher_folders(slug);

CREATE TABLE IF NOT EXISTS lemon_watchers (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(128) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(64) NOT NULL,
  feed_slug VARCHAR(128) NOT NULL,
  url TEXT NOT NULL,
  protocol VARCHAR(32) NOT NULL DEFAULT 'rss',
  status VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  poll_interval_seconds INT NOT NULL DEFAULT 900,
  cron_expression VARCHAR(64),
  default_tags JSONB DEFAULT '[]'::jsonb,
  etag TEXT,
  last_modified TEXT,
  last_ping_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  total_pings INT NOT NULL DEFAULT 0,
  consecutive_failures INT NOT NULL DEFAULT 0,
  total_items_ingested INT NOT NULL DEFAULT 0,
  last_latency_ms INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lemon_watchers_slug ON lemon_watchers(slug);
CREATE INDEX IF NOT EXISTS idx_lemon_watchers_category ON lemon_watchers(category);
CREATE INDEX IF NOT EXISTS idx_lemon_watchers_status ON lemon_watchers(status);

CREATE TABLE IF NOT EXISTS lemon_watcher_pings (
  id VARCHAR(64) PRIMARY KEY,
  watcher_id VARCHAR(64) NOT NULL REFERENCES lemon_watchers(id) ON DELETE CASCADE,
  status_code INT NOT NULL,
  latency_ms INT NOT NULL,
  items_found INT NOT NULL DEFAULT 0,
  new_items_count INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lemon_watcher_pings_watcher_id ON lemon_watcher_pings(watcher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lemon_watcher_pings_created_at ON lemon_watcher_pings(created_at DESC);

CREATE TABLE IF NOT EXISTS lemon_watcher_items (
  id VARCHAR(64) PRIMARY KEY,
  watcher_id VARCHAR(64) NOT NULL REFERENCES lemon_watchers(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  author VARCHAR(255) DEFAULT '',
  tags JSONB DEFAULT '[]'::jsonb,
  resonance_score INT NOT NULL DEFAULT 50,
  content_hash VARCHAR(64) NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  note_id VARCHAR(64),
  bus_published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lemon_watcher_items_watcher_guid UNIQUE(watcher_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_lemon_watcher_items_watcher_id ON lemon_watcher_items(watcher_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_lemon_watcher_items_published_at ON lemon_watcher_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_lemon_watcher_items_content_hash ON lemon_watcher_items(content_hash);

CREATE TABLE IF NOT EXISTS lemon_raw_news (
  id VARCHAR(64) PRIMARY KEY,
  watcher_id VARCHAR(64) NOT NULL REFERENCES lemon_watchers(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  content_raw TEXT DEFAULT '',
  author VARCHAR(255) DEFAULT '',
  pub_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  categories JSONB DEFAULT '[]'::jsonb,
  content_hash VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  note_id VARCHAR(64),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lemon_raw_news_watcher_guid UNIQUE(watcher_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_lemon_raw_news_status ON lemon_raw_news(status);
CREATE INDEX IF NOT EXISTS idx_lemon_raw_news_watcher_id ON lemon_raw_news(watcher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lemon_raw_news_pub_date ON lemon_raw_news(pub_date DESC);
`;

const DEFAULT_FOLDERS: Omit<WatcherFolder, 'createdAt'>[] = [
  {
    id: 'f-ai',
    slug: 'ai',
    title: 'AI & Нейросети',
    description: 'Официальные блоги и исследования AI (OpenAI, DeepMind, Anthropic, HuggingFace)',
    icon: '🤖',
    color: '#6366f1',
    isSystem: true,
  },
  {
    id: 'f-cybersec',
    slug: 'cybersec',
    title: 'Кибербезопасность',
    description: 'Уязвимости, эксплойты, CISA KEV и сводки The Hacker News',
    icon: '🛡️',
    color: '#ef4444',
    isSystem: true,
  },
  {
    id: 'f-habr',
    slug: 'habr',
    title: 'Хабр & IT',
    description: 'Лучшие статьи, новости индустрии и публикации разработчиков',
    icon: '💻',
    color: '#0ea5e9',
    isSystem: true,
  },
  {
    id: 'f-politics',
    slug: 'politics',
    title: 'Политика & Мир',
    description: 'Мировые новости, геополитика и ключевые события',
    icon: '🌍',
    color: '#10b981',
    isSystem: true,
  },
  {
    id: 'f-frontier',
    slug: 'frontier',
    title: 'Фронтир & Tech',
    description: 'Передовые технологии, гаджеты, наука и железо',
    icon: '🚀',
    color: '#a855f7',
    isSystem: true,
  },
];

export class DatabaseService {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }

  async initSchema(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);

    // Non-destructive column additions for existing installations
    await this.pool.query(`
      ALTER TABLE lemon_watchers ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0;
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS summary TEXT DEFAULT '';
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS content TEXT DEFAULT '';
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS author VARCHAR(255) DEFAULT '';
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS resonance_score INT NOT NULL DEFAULT 50;
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE lemon_watcher_items ADD COLUMN IF NOT EXISTS bus_published_at TIMESTAMPTZ;
    `);

    // Seed default folders
    for (const f of DEFAULT_FOLDERS) {
      await this.pool.query(
        `INSERT INTO lemon_watcher_folders (id, slug, title, description, icon, color, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO NOTHING`,
        [f.id, f.slug, f.title, f.description, f.icon, f.color, f.isSystem]
      );
    }
  }

  async upsertWatcher(config: WatcherConfig): Promise<WatcherState> {
    const res = await this.pool.query(
      `INSERT INTO lemon_watchers (
        id, slug, title, description, category, feed_slug, url, protocol,
        poll_interval_seconds, cron_expression, default_tags, enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        feed_slug = EXCLUDED.feed_slug,
        url = EXCLUDED.url,
        protocol = EXCLUDED.protocol,
        poll_interval_seconds = EXCLUDED.poll_interval_seconds,
        cron_expression = EXCLUDED.cron_expression,
        default_tags = EXCLUDED.default_tags,
        enabled = lemon_watchers.enabled,
        updated_at = NOW()
      RETURNING *`,
      [
        config.id,
        config.slug,
        config.title,
        config.description,
        config.category,
        config.feedSlug,
        config.url,
        config.protocol,
        config.pollIntervalSeconds,
        config.cronExpression || null,
        JSON.stringify(config.defaultTags || []),
        config.enabled,
      ]
    );

    return this.mapWatcherRowToState(res.rows[0]);
  }

  async updateWatcherState(
    id: string,
    updates: Partial<{
      status: string;
      lastPingAt: string;
      lastSuccessAt: string;
      lastError: string | null;
      etag: string | null;
      lastModified: string | null;
      consecutiveFailures: number;
      totalPingsIncrement: number;
      totalItemsIngestedIncrement: number;
      lastLatencyMs: number;
    }>
  ): Promise<void> {
    await this.pool.query(
      `UPDATE lemon_watchers SET
        status = COALESCE($2, status),
        last_ping_at = COALESCE($3::timestamptz, last_ping_at),
        last_success_at = COALESCE($4::timestamptz, last_success_at),
        last_error = $5,
        etag = COALESCE($6, etag),
        last_modified = COALESCE($7, last_modified),
        consecutive_failures = COALESCE($8, consecutive_failures),
        total_pings = total_pings + COALESCE($9, 0),
        total_items_ingested = total_items_ingested + COALESCE($10, 0),
        last_latency_ms = COALESCE($11, last_latency_ms),
        updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        updates.status || null,
        updates.lastPingAt || null,
        updates.lastSuccessAt || null,
        updates.lastError ?? null,
        updates.etag || null,
        updates.lastModified || null,
        updates.consecutiveFailures !== undefined ? updates.consecutiveFailures : null,
        updates.totalPingsIncrement || null,
        updates.totalItemsIngestedIncrement || null,
        updates.lastLatencyMs !== undefined ? updates.lastLatencyMs : null,
      ]
    );
  }

  async recordPing(params: {
    watcherId: string;
    statusCode: number;
    latencyMs: number;
    itemsFound: number;
    newItemsCount: number;
    error?: string | null;
  }): Promise<WatcherPingRecord> {
    const id = crypto.randomUUID();
    const res = await this.pool.query(
      `INSERT INTO lemon_watcher_pings (
        id, watcher_id, status_code, latency_ms, items_found, new_items_count, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        id,
        params.watcherId,
        params.statusCode,
        params.latencyMs,
        params.itemsFound,
        params.newItemsCount,
        params.error || null,
      ]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      watcherId: row.watcher_id,
      statusCode: row.status_code,
      latencyMs: row.latency_ms,
      itemsFound: row.items_found,
      newItemsCount: row.new_items_count,
      error: row.error,
      createdAt: row.created_at.toISOString(),
    };
  }

  async isItemAlreadyIngested(watcherId: string, guid: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM lemon_raw_news WHERE watcher_id = $1 AND guid = $2
       UNION
       SELECT 1 FROM lemon_watcher_items WHERE watcher_id = $1 AND guid = $2
       LIMIT 1`,
      [watcherId, guid]
    );
    return res.rowCount !== null && res.rowCount > 0;
  }

  // ── Raw News (Stage 1 autonomous collection) ─────────────────────────────

  async insertRawNews(item: {
    id?: string;
    watcherId: string;
    guid: string;
    url: string;
    title?: string;
    description?: string;
    contentRaw?: string;
    author?: string;
    pubDate?: string;
    categories?: string[];
    contentHash: string;
  }): Promise<RawNewsItem | null> {
    const id = item.id || crypto.randomUUID();
    const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

    const res = await this.pool.query(
      `INSERT INTO lemon_raw_news (
        id, watcher_id, guid, url, title, description, content_raw, author,
        pub_date, categories, content_hash, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING', NOW())
      ON CONFLICT (watcher_id, guid) DO NOTHING
      RETURNING *`,
      [
        id,
        item.watcherId,
        item.guid,
        item.url,
        item.title || '',
        item.description || '',
        item.contentRaw || '',
        item.author || '',
        pubDate,
        JSON.stringify(item.categories || []),
        item.contentHash,
      ]
    );

    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRawNewsRowToItem(res.rows[0]);
  }

  async getPendingRawNews(limit = 10): Promise<RawNewsItem[]> {
    const res = await this.pool.query(
      `SELECT r.*, w.slug as watcher_slug, w.title as watcher_title, w.category as watcher_category
       FROM lemon_raw_news r
       LEFT JOIN lemon_watchers w ON w.id = r.watcher_id
       WHERE r.status = 'PENDING'
       ORDER BY r.created_at ASC
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((row) => this.mapRawNewsRowToItem(row));
  }

  async updateRawNewsStatus(
    id: string,
    status: RawNewsStatus,
    noteId?: string | null,
    error?: string | null
  ): Promise<void> {
    await this.pool.query(
      `UPDATE lemon_raw_news
       SET status = $2,
           note_id = COALESCE($3, note_id),
           error = $4
       WHERE id = $1`,
      [id, status, noteId ?? null, error ?? null]
    );
  }

  async getRawNews(options: {
    limit?: number;
    offset?: number;
    watcherId?: string;
    category?: string;
    status?: string;
    search?: string;
  } = {}): Promise<PaginatedRawNews> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    const conditions: string[] = [];
    const values: any[] = [];
    let pIdx = 1;

    if (options.watcherId) {
      conditions.push(`(r.watcher_id = $${pIdx} OR w.slug = $${pIdx})`);
      values.push(options.watcherId);
      pIdx++;
    }

    if (options.category) {
      conditions.push(`w.category = $${pIdx}`);
      values.push(options.category);
      pIdx++;
    }

    if (options.status) {
      conditions.push(`r.status = $${pIdx}`);
      values.push(options.status);
      pIdx++;
    }

    if (options.search) {
      conditions.push(`(r.title ILIKE $${pIdx} OR r.description ILIKE $${pIdx})`);
      values.push(`%${options.search}%`);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await this.pool.query(
      `SELECT COUNT(*) FROM lemon_raw_news r
       LEFT JOIN lemon_watchers w ON w.id = r.watcher_id
       ${whereClause}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const query = `
      SELECT r.*, w.slug as watcher_slug, w.title as watcher_title, w.category as watcher_category
      FROM lemon_raw_news r
      LEFT JOIN lemon_watchers w ON w.id = r.watcher_id
      ${whereClause}
      ORDER BY r.pub_date DESC, r.created_at DESC
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    values.push(limit, offset);
    const res = await this.pool.query(query, values);

    return {
      items: res.rows.map((row) => this.mapRawNewsRowToItem(row)),
      total,
      limit,
      offset,
    };
  }

  async getRawNewsById(id: string): Promise<RawNewsItem | null> {
    const res = await this.pool.query(
      `SELECT r.*, w.slug as watcher_slug, w.title as watcher_title, w.category as watcher_category
       FROM lemon_raw_news r
       LEFT JOIN lemon_watchers w ON w.id = r.watcher_id
       WHERE r.id = $1 LIMIT 1`,
      [id]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapRawNewsRowToItem(res.rows[0]);
  }

  // Autonomous storage for ingested items with full content
  async recordIngestedItem(item: {
    id?: string;
    watcherId: string;
    guid: string;
    url: string;
    title?: string;
    summary?: string;
    content?: string;
    author?: string;
    tags?: string[];
    resonanceScore?: number;
    contentHash: string;
    publishedAt: string;
    rawPayload?: Record<string, any>;
    noteId?: string | null;
  }): Promise<WatcherArticle> {
    const id = item.id || crypto.randomUUID();
    const res = await this.pool.query(
      `INSERT INTO lemon_watcher_items (
        id, watcher_id, guid, url, title, summary, content, author,
        tags, resonance_score, content_hash, published_at, raw_payload, note_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13, $14)
      ON CONFLICT (watcher_id, guid) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        content = EXCLUDED.content,
        tags = EXCLUDED.tags,
        resonance_score = EXCLUDED.resonance_score
      RETURNING *`,
      [
        id,
        item.watcherId,
        item.guid,
        item.url,
        item.title || '',
        item.summary || '',
        item.content || '',
        item.author || '',
        JSON.stringify(item.tags || []),
        item.resonanceScore ?? 50,
        item.contentHash,
        item.publishedAt,
        JSON.stringify(item.rawPayload || {}),
        item.noteId || null,
      ]
    );

    return this.mapItemRowToArticle(res.rows[0]);
  }

  async getRecentItems(options: WatcherArticleQueryOptions = {}): Promise<PaginatedArticles> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const offset = Math.max(options.offset || 0, 0);

    const conditions: string[] = [];
    const values: any[] = [];
    let pIdx = 1;

    if (options.watcherId) {
      conditions.push(`(i.watcher_id = $${pIdx} OR w.slug = $${pIdx})`);
      values.push(options.watcherId);
      pIdx++;
    }

    if (options.category) {
      conditions.push(`w.category = $${pIdx}`);
      values.push(options.category);
      pIdx++;
    }

    if (options.search) {
      conditions.push(`(i.title ILIKE $${pIdx} OR i.summary ILIKE $${pIdx})`);
      values.push(`%${options.search}%`);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await this.pool.query(
      `SELECT COUNT(*) FROM lemon_watcher_items i
       LEFT JOIN lemon_watchers w ON w.id = i.watcher_id
       ${whereClause}`,
      values
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const query = `
      SELECT i.*, w.slug as watcher_slug, w.title as watcher_title, w.category as watcher_category
      FROM lemon_watcher_items i
      LEFT JOIN lemon_watchers w ON w.id = i.watcher_id
      ${whereClause}
      ORDER BY i.published_at DESC
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    values.push(limit, offset);
    const res = await this.pool.query(query, values);

    return {
      items: res.rows.map((row) => this.mapItemRowToArticle(row)),
      total,
      limit,
      offset,
    };
  }

  async getItemById(id: string): Promise<WatcherArticle | null> {
    const res = await this.pool.query(
      `SELECT i.*, w.slug as watcher_slug, w.title as watcher_title, w.category as watcher_category
       FROM lemon_watcher_items i
       LEFT JOIN lemon_watchers w ON w.id = i.watcher_id
       WHERE i.id = $1 LIMIT 1`,
      [id]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapItemRowToArticle(res.rows[0]);
  }

  async getPingHistory(watcherId: string, limit = 50): Promise<WatcherPingRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM lemon_watcher_pings
       WHERE watcher_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [watcherId, limit]
    );
    return res.rows.map((row) => ({
      id: row.id,
      watcherId: row.watcher_id,
      statusCode: row.status_code,
      latencyMs: row.latency_ms,
      itemsFound: row.items_found,
      newItemsCount: row.new_items_count,
      error: row.error,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async getAllWatchers(): Promise<WatcherState[]> {
    const res = await this.pool.query(
      `SELECT * FROM lemon_watchers ORDER BY category, title`
    );
    return res.rows.map((row) => this.mapWatcherRowToState(row));
  }

  async getFolders(): Promise<WatcherFolder[]> {
    const res = await this.pool.query(`
      SELECT f.*,
        COUNT(w.id) as watchers_count,
        COUNT(w.id) FILTER (WHERE w.enabled = true) as active_watchers_count
      FROM lemon_watcher_folders f
      LEFT JOIN lemon_watchers w ON w.category = f.slug
      GROUP BY f.id
      ORDER BY f.is_system DESC, f.created_at ASC
    `);

    return res.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description || '',
      icon: r.icon || '📁',
      color: r.color || '#eab308',
      isSystem: r.is_system,
      watchersCount: parseInt(r.watchers_count || '0', 10),
      createdAt: r.created_at.toISOString(),
    }));
  }

  async createFolder(data: {
    title: string;
    slug?: string;
    icon?: string;
    color?: string;
    description?: string;
  }): Promise<WatcherFolder> {
    const id = `f-${crypto.randomUUID().slice(0, 8)}`;
    const baseSlug = (data.slug || data.title)
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-|-$/g, '') || `folder-${Date.now()}`;
    const slug = baseSlug.slice(0, 64);

    const res = await this.pool.query(
      `INSERT INTO lemon_watcher_folders (id, slug, title, description, icon, color, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         icon = EXCLUDED.icon,
         color = EXCLUDED.color
       RETURNING *`,
      [id, slug, data.title, data.description || '', data.icon || '📁', data.color || '#eab308']
    );

    const r = res.rows[0];
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      icon: r.icon,
      color: r.color,
      isSystem: r.is_system,
      watchersCount: 0,
      createdAt: r.created_at.toISOString(),
    };
  }

  async deleteFolder(idOrSlug: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM lemon_watcher_folders
       WHERE (id = $1 OR slug = $1) AND is_system = false
       RETURNING id`,
      [idOrSlug]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async deleteWatcher(idOrSlug: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM lemon_watchers WHERE id = $1 OR slug = $1 RETURNING id`,
      [idOrSlug]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async updateWatcherConfig(
    idOrSlug: string,
    updates: Partial<{
      title: string;
      description: string;
      category: string;
      url: string;
      protocol: string;
      pollIntervalSeconds: number;
      defaultTags: string[];
      enabled: boolean;
    }>
  ): Promise<WatcherState | null> {
    const res = await this.pool.query(
      `UPDATE lemon_watchers SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        category = COALESCE($4, category),
        url = COALESCE($5, url),
        protocol = COALESCE($6, protocol),
        poll_interval_seconds = COALESCE($7, poll_interval_seconds),
        default_tags = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE default_tags END,
        enabled = COALESCE($9, enabled),
        status = CASE WHEN $9 = false THEN 'PAUSED' ELSE status END,
        updated_at = NOW()
       WHERE id = $1 OR slug = $1
       RETURNING *`,
      [
        idOrSlug,
        updates.title ?? null,
        updates.description ?? null,
        updates.category ?? null,
        updates.url ?? null,
        updates.protocol ?? null,
        updates.pollIntervalSeconds ?? null,
        updates.defaultTags ? JSON.stringify(updates.defaultTags) : null,
        typeof updates.enabled === 'boolean' ? updates.enabled : null,
      ]
    );

    if (res.rows.length === 0) return null;
    return this.mapWatcherRowToState(res.rows[0]);
  }

  async setWatcherEnabled(idOrSlug: string, enabled: boolean): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE lemon_watchers
       SET enabled = $2,
           status = CASE WHEN $2 = false THEN 'PAUSED' ELSE status END,
           updated_at = NOW()
       WHERE id = $1 OR slug = $1
       RETURNING id`,
      [idOrSlug, enabled]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getMetrics(): Promise<WatcherMetricsSnapshot> {
    const watchersRes = await this.pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE enabled = true AND status != 'ERROR') as active,
        COALESCE(SUM(total_pings), 0) as total_pings,
        COALESCE(SUM(total_items_ingested), 0) as total_notes,
        COALESCE(AVG(last_latency_ms), 0) as avg_latency
       FROM lemon_watchers`
    );

    const pings24hRes = await this.pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 400) as success
       FROM lemon_watcher_pings
       WHERE created_at >= NOW() - INTERVAL '24 hours'`
    );

    const wRow = watchersRes.rows[0];
    const pRow = pings24hRes.rows[0];
    const total24h = parseInt(pRow?.total || '0', 10);
    const success24h = parseInt(pRow?.success || '0', 10);
    const successRatePercent = total24h > 0 ? Math.round((success24h / total24h) * 100) : 100;

    return {
      activeWatchers: parseInt(wRow.active || '0', 10),
      totalWatchers: parseInt(wRow.total || '0', 10),
      totalPings: parseInt(wRow.total_pings || '0', 10),
      totalNotesIngested: parseInt(wRow.total_notes || '0', 10),
      avgLatencyMs: Math.round(parseFloat(wRow.avg_latency || '0')),
      successRatePercent,
      timestamp: new Date().toISOString(),
    };
  }

  // ── LemonBus Publishing & Bridge State ────────────────────────────────────

  async markItemPublishedToBus(id: string): Promise<WatcherArticle | null> {
    const res = await this.pool.query(
      `UPDATE lemon_watcher_items
       SET bus_published_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (!res.rowCount || res.rowCount === 0) return null;
    return this.mapItemRowToArticle(res.rows[0]);
  }

  async getPendingBusArticles(limit = 50): Promise<WatcherArticle[]> {
    const res = await this.pool.query(
      `SELECT i.*, w.slug as watcher_slug, w.title as watcher_title, w.category as watcher_category
       FROM lemon_watcher_items i
       LEFT JOIN lemon_watchers w ON w.id = i.watcher_id
       WHERE i.bus_published_at IS NULL
       ORDER BY i.created_at ASC
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((row) => this.mapItemRowToArticle(row));
  }

  async getBusMetrics(): Promise<{ total: number; published: number; pending: number }> {
    const res = await this.pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE bus_published_at IS NOT NULL) as published,
        COUNT(*) FILTER (WHERE bus_published_at IS NULL) as pending
      FROM lemon_watcher_items
    `);
    const row = res.rows[0];
    return {
      total: parseInt(row?.total || '0', 10),
      published: parseInt(row?.published || '0', 10),
      pending: parseInt(row?.pending || '0', 10),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapWatcherRowToState(row: any): WatcherState {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      category: row.category,
      feedSlug: row.feed_slug,
      status: row.status,
      lastPingAt: row.last_ping_at ? row.last_ping_at.toISOString() : null,
      lastSuccessAt: row.last_success_at ? row.last_success_at.toISOString() : null,
      lastError: row.last_error,
      etag: row.etag,
      lastModified: row.last_modified,
      consecutiveFailures: row.consecutive_failures || 0,
      totalPings: row.total_pings || 0,
      totalItemsIngested: row.total_items_ingested || 0,
      lastLatencyMs: row.last_latency_ms || 0,
      url: row.url,
      protocol: row.protocol,
      pollIntervalSeconds: row.poll_interval_seconds,
      enabled: row.enabled,
    };
  }

  private mapItemRowToArticle(row: any): WatcherArticle {
    let tags: string[] = [];
    if (Array.isArray(row.tags)) {
      tags = row.tags;
    } else if (typeof row.tags === 'string') {
      try {
        tags = JSON.parse(row.tags);
      } catch {
        tags = [];
      }
    }

    return {
      id: row.id,
      watcherId: row.watcher_id,
      watcherSlug: row.watcher_slug,
      watcherTitle: row.watcher_title,
      category: row.watcher_category,
      guid: row.guid,
      url: row.url,
      title: row.title || '',
      summary: row.summary || '',
      content: row.content || '',
      author: row.author || '',
      tags,
      resonanceScore: row.resonance_score ?? 50,
      contentHash: row.content_hash,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : new Date().toISOString(),
      rawPayload: typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload || {},
      busPublishedAt: row.bus_published_at ? new Date(row.bus_published_at).toISOString() : null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }

  private mapRawNewsRowToItem(row: any): RawNewsItem {
    let categories: string[] = [];
    if (Array.isArray(row.categories)) {
      categories = row.categories;
    } else if (typeof row.categories === 'string') {
      try {
        categories = JSON.parse(row.categories);
      } catch {
        categories = [];
      }
    }

    return {
      id: row.id,
      watcherId: row.watcher_id,
      watcherSlug: row.watcher_slug,
      watcherTitle: row.watcher_title,
      category: row.watcher_category,
      guid: row.guid,
      url: row.url,
      title: row.title || '',
      description: row.description || '',
      contentRaw: row.content_raw || '',
      author: row.author || '',
      pubDate: row.pub_date ? new Date(row.pub_date).toISOString() : new Date().toISOString(),
      categories,
      contentHash: row.content_hash,
      status: row.status,
      noteId: row.note_id,
      error: row.error,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }
}
