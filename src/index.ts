import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { WatchersEngine } from './orchestrator/watchers-engine.js';
import { WatchersHttpServer } from './server/watchers-http.server.js';

export * from './types/watcher.types.js';
export * from './types/ping.types.js';
export * from './types/note-payload.types.js';
export * from './types/article.types.js';
export * from './sources/sources-catalog.js';

async function bootstrap() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       🍋 LEMON-WATCHERS: REACTIVE NEWS ENGINE 🍋              ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📡 LemonBus URL: ${config.lemonBusUrl}`);
  console.log(`🗄️ Database: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`🤖 Gemini Model: ${config.geminiModel} (AI: ${config.enableAiEnrichment})`);
  console.log(`⏱️ Default Interval: ${config.defaultPollIntervalSeconds}s`);
  console.log('───────────────────────────────────────────────────────────────');

  const engine = new WatchersEngine(config);
  const server = new WatchersHttpServer(config.port, engine);

  await engine.initialize();
  await server.start();

  const shutdown = async () => {
    console.log('\n🛑 [Lemon-Watchers] Gracefully shutting down...');
    await server.stop();
    await engine.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Auto-run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  bootstrap().catch((err) => {
    console.error('❌ [Lemon-Watchers] Fatal startup error:', err);
    process.exit(1);
  });
}
