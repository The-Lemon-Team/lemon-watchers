import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { WatchersEngine } from './orchestrator/watchers-engine.js';
import { WatchersHttpServer } from './server/watchers-http.server.js';
import { ProjectariumAxon } from './axons/projectarium.axon.js';

export * from './types/watcher.types.js';
export * from './types/ping.types.js';
export * from './types/note-payload.types.js';
export * from './types/article.types.js';
export * from './sources/sources-catalog.js';

async function bootstrap() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('       🍋 LEMON-WATCHERS: REACTIVE NEWS ENGINE 🍋              ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📡 LemonBus URL: ${config.lemonBusUrl} (moderation: ${config.busModerationMode})`);
  console.log(`🗄️ Database: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`🤖 AI Service: ${config.aiServiceUrl} (enabled: ${config.enableAiService}, fallback model: ${config.geminiModel})`);
  console.log(`🖼️ Media Hub: ${config.mediaHubUrl} (covers: ${config.enableCoverGeneration})`);
  console.log(`🛡️ Projectarium: ${config.projectariumUrl} (enabled: ${config.enableProjectarium})`);
  console.log(`⏱️ Default Interval: ${config.defaultPollIntervalSeconds}s`);
  console.log('───────────────────────────────────────────────────────────────');

  const projectarium = new ProjectariumAxon({
    baseUrl: config.projectariumUrl,
    preferredPort: config.port,
    enabled: config.enableProjectarium,
  });

  const registration = await projectarium.register();
  const listenPort = registration?.port ?? config.port;

  const engine = new WatchersEngine(config);
  const server = new WatchersHttpServer(listenPort, engine);

  await engine.initialize();
  await server.start();

  const shutdown = async () => {
    console.log('\n🛑 [Lemon-Watchers] Gracefully shutting down...');
    await projectarium.release();
    await server.stop();
    await engine.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Autonomous Lemon-Watchers Engine v1.0.3
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  bootstrap().catch((err) => {
    console.error('❌ [Lemon-Watchers] Fatal startup error:', err);
    process.exit(1);
  });
}
