import dotenv from 'dotenv';
dotenv.config();

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
  watcherProxyUrl: process.env.WATCHER_PROXY_URL || undefined,
};
