import { WatcherConfig, WatcherCategory } from '../types/watcher.types.js';
import { AI_SOURCES } from './ai.sources.js';
import { CYBERSEC_SOURCES } from './cybersec.sources.js';
import { HABR_SOURCES } from './habr.sources.js';
import { POLITICS_SOURCES } from './politics.sources.js';
import { FRONTIER_SOURCES } from './frontier.sources.js';

export const ALL_VERIFIED_SOURCES: WatcherConfig[] = [
  ...AI_SOURCES,
  ...CYBERSEC_SOURCES,
  ...HABR_SOURCES,
  ...POLITICS_SOURCES,
  ...FRONTIER_SOURCES,
];

export function getSourcesByCategory(category: WatcherCategory): WatcherConfig[] {
  return ALL_VERIFIED_SOURCES.filter((s) => s.category === category);
}

export function findSourceBySlug(slug: string): WatcherConfig | undefined {
  return ALL_VERIFIED_SOURCES.find((s) => s.slug === slug || s.id === slug);
}
