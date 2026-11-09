-- Lemon-Watchers Database Schema for PostgreSQL
-- Completely autonomous storage: no dependencies on external schemas

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

-- Autonomous storage for collected articles and news items
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lemon_watcher_items_watcher_guid UNIQUE(watcher_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_lemon_watcher_items_watcher_id ON lemon_watcher_items(watcher_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_lemon_watcher_items_published_at ON lemon_watcher_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_lemon_watcher_items_content_hash ON lemon_watcher_items(content_hash);
