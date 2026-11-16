import { AiStudioAxon, ImageAspectRatio } from '@lemon/ai-neurons';
import { MediaLifecycleAxon } from '@lemon/media-hub-neurons';

export interface MediaCoverResult {
  coverUrl: string;
  coverThumbnailUrl: string;
  coverAssetId: string | null;
  synthesizedPrompt?: string;
  model?: string;
  isFallback?: boolean;
}

export interface MediaCoverAxonOptions {
  aiStudio?: AiStudioAxon;
  mediaHub?: MediaLifecycleAxon;
  mediaHubBaseUrl?: string;
  enabled?: boolean;
}

/**
 * Coordinates news cover generation via @lemon/ai-neurons (Umniy Lemon)
 * and asset storage/resolution via @lemon/media-hub-neurons (Lemon Media Hub).
 */
export class MediaCoverAxon {
  private readonly aiStudio?: AiStudioAxon;
  private readonly mediaHub?: MediaLifecycleAxon;
  private readonly mediaHubBaseUrl: string;
  private readonly enabled: boolean;

  constructor(options: MediaCoverAxonOptions) {
    this.aiStudio = options.aiStudio;
    this.mediaHub = options.mediaHub;
    this.mediaHubBaseUrl = (
      options.mediaHubBaseUrl ||
      options.mediaHub?.apiClient.baseUrl ||
      'http://127.0.0.1:3005'
    ).replace(/\/+$/, '');
    this.enabled = options.enabled !== false;
  }

  resolveMediaUrl(url?: string | null): string | null {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (this.mediaHub) {
      return this.mediaHub.apiClient.resolveUrl(url);
    }
    const clean = url.startsWith('/') ? url : `/${url}`;
    return `${this.mediaHubBaseUrl}${clean}`;
  }

  buildCoverPrompt(params: {
    title: string;
    summary?: string;
    category?: string;
    coverPrompt?: string;
  }): string {
    if (params.coverPrompt && params.coverPrompt.trim().length > 5) {
      return params.coverPrompt.trim();
    }
    const topic = params.title.slice(0, 140);
    const cat = params.category || 'technology';
    return `Modern clean editorial illustration for news article about "${topic}" in ${cat} domain, minimal geometric lighting, high contrast, no text, no watermarks`;
  }

  async generateCoverForArticle(params: {
    id: string;
    title: string;
    summary?: string;
    category?: string;
    tags?: string[];
    coverPrompt?: string;
    style?: string;
    aspectRatio?: ImageAspectRatio;
  }): Promise<MediaCoverResult | null> {
    if (!this.enabled || !this.aiStudio) return null;

    const prompt = this.buildCoverPrompt(params);
    const cleanTags = Array.from(
      new Set([
        'news-cover',
        ...(params.category ? [params.category] : []),
        ...(params.tags || []).slice(0, 4),
      ])
    );

    try {
      const res = await this.aiStudio.generateImages({
        prompt,
        style: params.style || 'editorial',
        aspectRatio: params.aspectRatio || '16:9',
        folderPath: 'covers',
        count: 1,
        tags: cleanTags,
        context: (params.summary || params.title).slice(0, 240),
        correlationId: params.id,
      });

      const asset = res.items?.[0];
      if (!asset) return null;

      const coverUrl = this.resolveMediaUrl(asset.url);
      if (!coverUrl) return null;

      return {
        coverUrl,
        coverThumbnailUrl: this.resolveMediaUrl(asset.thumbnailUrl) || coverUrl,
        coverAssetId: asset.id || null,
        synthesizedPrompt: res.synthesizedPrompt || prompt,
        model: res.model,
        isFallback: res.isFallback,
      };
    } catch (err: any) {
      console.warn(
        `[MediaCoverAxon] AI cover generation unavailable for "${params.title}": ${err?.message || err}`
      );
      return null;
    }
  }

  async ingestExternalImage(params: {
    imageUrl: string;
    title: string;
    category?: string;
    tags?: string[];
    correlationId?: string;
  }): Promise<MediaCoverResult> {
    if (this.mediaHub && this.enabled) {
      try {
        const res = await fetch(params.imageUrl, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || 'image/jpeg';
          if (contentType.startsWith('image/')) {
            const buffer = await res.arrayBuffer();
            const ext = contentType.includes('png')
              ? 'png'
              : contentType.includes('webp')
                ? 'webp'
                : 'jpg';
            const ingested = await this.mediaHub.addMedia({
              file: buffer,
              filename: `cover-${params.correlationId || Date.now()}.${ext}`,
              mimeType: contentType,
              folderPath: 'covers',
              title: params.title.slice(0, 120),
              visibility: 'PUBLIC',
              tags: Array.from(new Set(['rss-cover', ...(params.tags || []).slice(0, 4)])),
              dedupKey: params.imageUrl,
            });
            const coverUrl = this.resolveMediaUrl(ingested.asset.url) || params.imageUrl;
            const thumbUrl =
              this.resolveMediaUrl(ingested.asset.thumbnailUrl) || coverUrl;
            return {
              coverUrl,
              coverThumbnailUrl: thumbUrl,
              coverAssetId: ingested.asset.id,
            };
          }
        }
      } catch (err: any) {
        console.warn(
          `[MediaCoverAxon] Media Hub ingest fallback for external image (${params.imageUrl}): ${err?.message || err}`
        );
      }
    }

    return {
      coverUrl: params.imageUrl,
      coverThumbnailUrl: params.imageUrl,
      coverAssetId: null,
    };
  }

  async resolveArticleCover(params: {
    id: string;
    title: string;
    summary?: string;
    category?: string;
    tags?: string[];
    coverPrompt?: string;
    externalImageUrl?: string;
  }): Promise<MediaCoverResult | null> {
    const generated = await this.generateCoverForArticle(params);
    if (generated) return generated;

    if (params.externalImageUrl) {
      return this.ingestExternalImage({
        imageUrl: params.externalImageUrl,
        title: params.title,
        category: params.category,
        tags: params.tags,
        correlationId: params.id,
      });
    }

    return null;
  }
}
