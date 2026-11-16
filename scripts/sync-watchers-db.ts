import { DatabaseService } from '../src/db/database.service.js';
import { ALL_VERIFIED_SOURCES } from '../src/sources/sources-catalog.js';
import { config } from '../src/config.js';

async function sync() {
  console.log('Connecting to database...');
  const db = new DatabaseService(config.databaseUrl);
  await db.initSchema();

  console.log(`Syncing ${ALL_VERIFIED_SOURCES.length} sources to database...`);
  for (const source of ALL_VERIFIED_SOURCES) {
    const res = await db.upsertWatcher(source);
    console.log(`[SYNCED] ${res.id} -> ${res.title} (${res.url})`);
  }

  // Clear consecutive failures and last_error for fixed watchers
  const fixedIds = [
    'w-anthropic-news',
    'w-deepmind-blog',
    'w-tass-world',
    'w-thehackernews',
    'w-interfax-main',
    'w-xakep-feed'
  ];

  for (const id of fixedIds) {
    await db.updateWatcherState(id, {
      lastError: null,
      consecutiveFailures: 0,
      status: 'ACTIVE',
    });
    console.log(`[RESET ERROR] Watcher ${id} error state reset to ACTIVE`);
  }

  console.log('Done!');
  process.exit(0);
}

sync().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
