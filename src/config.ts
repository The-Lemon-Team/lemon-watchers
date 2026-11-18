import dotenv from 'dotenv';
dotenv.config({ override: true });

export interface AppConfig {
  port: number;
  databaseUrl: string;
  lemonBusUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  httpsProxy?: string;
  httpProxy?: string;
  deviceId: string;
  defaultPollIntervalSeconds: number;
  enableAiEnrichment: boolean;
  watcherProxyUrl?: string;
  coreCombinatorUrl: string;
  enableCoreCombinator: boolean;
  aiServiceUrl: string;
  aiServiceApiKey: string;
  enableAiService: boolean;
  mediaHubUrl: string;
  mediaHubApiKey: string;
  enableMediaHub: boolean;
  enableCoverGeneration: boolean;
  projectariumUrl: string;
  enableProjectarium: boolean;
  frontendPort: number;
  busModerationMode: boolean;
  rawNewsTtlHours: number;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3040', 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://lemon:lemon_secret@127.0.0.1:5434/lemon_calendarium?schema=public',
  lemonBusUrl: process.env.LEMON_BUS_URL || 'http://127.0.0.1:3030',
  geminiApiKey: (process.env.GEMINI_API_KEY || '').replace(/^["']|["']$/g, ''),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  httpsProxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY,
  httpProxy: process.env.HTTP_PROXY || process.env.HTTPS_PROXY,
  deviceId: process.env.DEVICE_ID || 'lemon-watchers-home',
  defaultPollIntervalSeconds: parseInt(
    process.env.POLL_INTERVAL_SECONDS || '900',
    10
  ),
  enableAiEnrichment: process.env.ENABLE_AI_ENRICHMENT !== 'false',
  watcherProxyUrl:
    process.env.WATCHER_PROXY_URL && !process.env.WATCHER_PROXY_URL.includes('168.81.248.42')
      ? process.env.WATCHER_PROXY_URL
      : undefined,
  coreCombinatorUrl: process.env.CORE_COMBINATOR_URL || 'http://127.0.0.1:3000/api',
  enableCoreCombinator: process.env.ENABLE_CORE_COMBINATOR !== 'false',
  aiServiceUrl: process.env.LEMON_AI_SERVICE_URL || 'http://127.0.0.1:3006',
  aiServiceApiKey: process.env.LEMON_AI_API_KEY || 'lai_dev_watchers_key',
  enableAiService: process.env.ENABLE_AI_SERVICE !== 'false',
  mediaHubUrl: process.env.LEMON_MEDIA_HUB_URL || 'http://127.0.0.1:3005',
  mediaHubApiKey: process.env.LEMON_MEDIA_HUB_API_KEY || 'lmh_dev_watchers_key',
  enableMediaHub: process.env.ENABLE_MEDIA_HUB !== 'false',
  enableCoverGeneration: process.env.ENABLE_COVER_GENERATION !== 'false',
  projectariumUrl:
    process.env.PROJECTARIUM_URL ||
    process.env.CORE_COMBINATOR_URL ||
    'http://127.0.0.1:3000/api',
  enableProjectarium: process.env.ENABLE_PROJECTARIUM !== 'false',
  frontendPort: parseInt(process.env.FRONTEND_PORT || '4200', 10),
  busModerationMode: process.env.BUS_MODERATION_MODE !== 'false',
  rawNewsTtlHours: Math.max(1, parseInt(process.env.RAW_NEWS_TTL_HOURS || '72', 10)),
};
