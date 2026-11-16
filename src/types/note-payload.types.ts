export interface SparkNotePayload {
  id: string;
  title: string;
  summary: string;
  rawContent: string;
  eventDate: string; // ISO 8601 string of actual occurrence
  type: 'SINGLE' | 'PERIOD';
  privacy: 'public' | 'private';
  status: 'PUBLISHED' | 'DRAFT';
  feedSlug: string;
  publicFeedSlug: string;
  sourceLink: string;
  sourceType: 'LEMON_WATCHERS';
  author?: string;
  tags: string[]; // Strictly without '#', never includes 'jmdaily'
  resonanceScore: number; // 0..100
  icon?: string;
  coverUrl?: string | null;
  coverThumbnailUrl?: string | null;
  coverAssetId?: string | null;
  metadata: Record<string, any>;
}
