import { HttpsProxyAgent } from 'https-proxy-agent';
import { AiStudioAxon, ImageAspectRatio } from '@lemon/ai-neurons';
import { MediaLifecycleAxon, MediaViewResolved } from '@lemon/media-hub-neurons';
import {
  extractFirstImageFromHtml,
  resolveCandidateImageUrl,
} from './rss-atom-fetcher.axon.js';

export interface MediaCoverResult {
  coverUrl: string;
  coverThumbnailUrl: string;
  coverAssetId: string | null;
  synthesizedPrompt?: string;
  model?: string;
  isFallback?: boolean;
  source?: 'original' | 'ai';
  originalImageUrl?: string;
}

export interface MediaCoverAxonOptions {
  aiStudio?: AiStudioAxon;
  mediaHub?: MediaLifecycleAxon;
  mediaHubBaseUrl?: string;
  proxyUrl?: string;
  enabled?: boolean;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Coordinates news cover loading/ingestion (original news covers + AI fallback)
 * via @lemon/media-hub-neurons (MediaLifecycleAxon: MediaIngestFlow, MediaViewFlow)
 * and @lemon/ai-neurons (Umniy Lemon).
 */
export class MediaCoverAxon {
  private readonly aiStudio?: AiStudioAxon;
  private readonly mediaHub?: MediaLifecycleAxon;
  private readonly mediaHubBaseUrl: string;
  private readonly proxyAgent?: HttpsProxyAgent<string>;
  private readonly enabled: boolean;

  constructor(options: MediaCoverAxonOptions) {
    this.aiStudio = options.aiStudio;
    this.mediaHub = options.mediaHub;
    this.mediaHubBaseUrl = (
      options.mediaHubBaseUrl ||
      options.mediaHub?.apiClient?.baseUrl ||
      'http://127.0.0.1:3005'
    ).replace(/\/+$/, '');
    this.enabled = options.enabled !== false;

    if (options.proxyUrl) {
      try {
        this.proxyAgent = new HttpsProxyAgent(options.proxyUrl);
      } catch (err: any) {
        console.warn(`[MediaCoverAxon] Proxy init warning: ${err?.message || err}`);
      }
    }
  }

  resolveMediaUrl(url?: string | null): string | null {
    if (!url) return null;
    if (/^(?:https?:|data:|blob:)/i.test(url)) return url;
    if (this.mediaHub?.apiClient) {
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

  /**
   * Extracts original cover URL from article HTML (og:image, twitter:image, link[rel=image_src], or <img>).
   */
  extractOriginalImageFromHtml(html: string, baseUrl?: string): string | null {
    if (!html) return null;

    const metaPatterns: RegExp[] = [
      /<meta\b[^>]*\b(?:property|name)=["'](?:og:image:secure_url|og:image:url|og:image|twitter:image:src|twitter:image)["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi,
      /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\b(?:property|name)=["'](?:og:image:secure_url|og:image:url|og:image|twitter:image:src|twitter:image)["'][^>]*>/gi,
      /<meta\b[^>]*\bitemprop=["']image["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi,
      /<link\b[^>]*\brel=["']image_src["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
      /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']image_src["'][^>]*>/gi,
    ];

    for (const pattern of metaPatterns) {
      const match = pattern.exec(html);
      if (match?.[1]) {
        const resolved = resolveCandidateImageUrl(match[1], baseUrl);
        if (resolved) return resolved;
      }
    }

    return extractFirstImageFromHtml(html, baseUrl) || null;
  }

  /**
   * Fetches an article webpage and extracts its og:image / twitter:image cover URL.
   */
  async fetchOriginalImageUrlFromPage(articleUrl: string): Promise<string | null> {
    if (!articleUrl || !/^https?:\/\//i.test(articleUrl)) return null;

    try {
      const fetchOptions: any = {
        method: 'GET',
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(6000),
      };
      if (this.proxyAgent) {
        fetchOptions.agent = this.proxyAgent;
      }

      const res = await fetch(articleUrl, fetchOptions);
      if (!res.ok) return null;

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml')
      ) {
        return null;
      }

      const html = (await res.text()).slice(0, 300_000);
      return this.extractOriginalImageFromHtml(html, articleUrl);
    } catch {
      return null;
    }
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
        source: 'ai',
      };
    } catch (err: any) {
      console.warn(
        `[MediaCoverAxon] AI cover generation unavailable for "${params.title}": ${err?.message || err}`
      );
      return null;
    }
  }

  /**
   * Downloads an original news cover image and persists it into Lemon Media Hub
   * via MediaLifecycleAxon.addMedia (MediaIngestFlow), then resolves via MediaViewFlow.
   */
  async ingestExternalImage(params: {
    imageUrl: string;
    title: string;
    category?: string;
    tags?: string[];
    correlationId?: string;
    articleUrl?: string;
  }): Promise<MediaCoverResult | null> {
    let imageBuffer: ArrayBuffer;
    let detectedMime: string;

    try {
      const headers: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      };
      if (params.articleUrl && /^https?:\/\//i.test(params.articleUrl)) {
        headers.Referer = params.articleUrl;
      }

      const fetchOptions: any = {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      };
      if (this.proxyAgent) {
        fetchOptions.agent = this.proxyAgent;
      }

      const res = await fetch(params.imageUrl, fetchOptions);
      if (!res.ok) {
        console.warn(
          `[MediaCoverAxon] External image HTTP ${res.status} for ${params.imageUrl}`
        );
        return null;
      }

      imageBuffer = await res.arrayBuffer();
      const headerMime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const validated = this.detectImageMime(new Uint8Array(imageBuffer), headerMime, params.imageUrl);
      if (!validated) {
        console.warn(
          `[MediaCoverAxon] Response is not a valid image (${headerMime || 'unknown'}) for ${params.imageUrl}`
        );
        return null;
      }
      detectedMime = validated;
    } catch (err: any) {
      console.warn(
        `[MediaCoverAxon] Failed to download original image (${params.imageUrl}): ${err?.message || err}`
      );
      return null;
    }

    if (this.mediaHub && this.enabled) {
      try {
        const ext = this.mimeToExtension(detectedMime);
        const ingested = await this.mediaHub.addMedia({
          file: imageBuffer,
          filename: `cover-${params.correlationId || Date.now()}.${ext}`,
          mimeType: detectedMime,
          folderPath: 'covers',
          title: params.title.slice(0, 120),
          description: params.articleUrl ? `Original cover from ${params.articleUrl}` : undefined,
          visibility: 'PUBLIC',
          tags: Array.from(
            new Set([
              'news-cover',
              'original-cover',
              ...(params.category ? [params.category] : []),
              ...(params.tags || []).slice(0, 4),
            ])
          ),
          dedupKey: params.imageUrl,
        });

        let coverUrl = this.resolveMediaUrl(ingested.asset.url) || params.imageUrl;
        let thumbUrl = this.resolveMediaUrl(ingested.asset.thumbnailUrl) || coverUrl;

        if (ingested.asset.id && typeof this.mediaHub.viewMedia === 'function') {
          try {
            const view = await this.mediaHub.viewMedia({
              assetId: ingested.asset.id,
              viewerContext: 'lemon-watchers:cover-ingest',
            });
            if (view?.url) coverUrl = view.url;
            if (view?.asset?.thumbnailUrl) {
              thumbUrl = this.resolveMediaUrl(view.asset.thumbnailUrl) || coverUrl;
            }
          } catch {
            // Non-fatal: keep asset URL from ingest result
          }
        }

        return {
          coverUrl,
          coverThumbnailUrl: thumbUrl,
          coverAssetId: ingested.asset.id,
          source: 'original',
          originalImageUrl: params.imageUrl,
        };
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
      source: 'original',
      originalImageUrl: params.imageUrl,
    };
  }

  /**
   * Resolves a stored cover asset URL & metadata using MediaLifecycleAxon.viewMedia (MediaViewFlow).
   */
  async loadCoverView(assetId: string, variant?: string): Promise<MediaViewResolved | null> {
    if (!this.mediaHub || !assetId) return null;
    try {
      return await this.mediaHub.viewMedia({
        assetId,
        variant,
        viewerContext: 'lemon-watchers:cover-load',
      });
    } catch (err: any) {
      console.warn(`[MediaCoverAxon] Failed to load cover view for asset ${assetId}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Streams a stored cover image from Lemon Media Hub using MediaViewFlow + MediaHubApiClient.
   */
  async fetchCoverStream(
    assetId: string,
    variant?: string
  ): Promise<{ response: Response; contentType: string } | null> {
    if (!this.mediaHub || !assetId) return null;
    try {
      const resolved = await this.loadCoverView(assetId, variant);
      const targetVariant = variant || resolved?.variant;
      const res = await this.mediaHub.apiClient.fetchAssetStream(assetId, targetVariant);
      if (!res.ok) return null;
      return {
        response: res,
        contentType: res.headers.get('content-type') || 'image/webp',
      };
    } catch (err: any) {
      console.warn(`[MediaCoverAxon] Failed to stream cover asset ${assetId}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Finds (from feed/HTML or article og:image) and saves the original cover for a news item.
   */
  async resolveOriginalCover(params: {
    id: string;
    title: string;
    category?: string;
    tags?: string[];
    externalImageUrl?: string;
    articleUrl?: string;
  }): Promise<MediaCoverResult | null> {
    const candidateUrl =
      resolveCandidateImageUrl(params.externalImageUrl, params.articleUrl) ||
      (params.articleUrl ? await this.fetchOriginalImageUrlFromPage(params.articleUrl) : null);

    if (!candidateUrl) return null;

    return this.ingestExternalImage({
      imageUrl: candidateUrl,
      title: params.title,
      category: params.category,
      tags: params.tags,
      correlationId: params.id,
      articleUrl: params.articleUrl,
    });
  }

  async resolveArticleCover(params: {
    id: string;
    title: string;
    summary?: string;
    category?: string;
    tags?: string[];
    coverPrompt?: string;
    externalImageUrl?: string;
    articleUrl?: string;
    preferOriginal?: boolean;
  }): Promise<MediaCoverResult | null> {
    if (params.preferOriginal !== false) {
      const original = await this.resolveOriginalCover({
        id: params.id,
        title: params.title,
        category: params.category,
        tags: params.tags,
        externalImageUrl: params.externalImageUrl,
        articleUrl: params.articleUrl,
      });
      if (original) return original;

      return this.generateCoverForArticle(params);
    }

    const generated = await this.generateCoverForArticle(params);
    if (generated && !generated.isFallback) return generated;

    const original = await this.resolveOriginalCover({
      id: params.id,
      title: params.title,
      category: params.category,
      tags: params.tags,
      externalImageUrl: params.externalImageUrl,
      articleUrl: params.articleUrl,
    });
    if (original) return original;

    return generated;
  }

  private detectImageMime(
    bytes: Uint8Array,
    headerMime: string,
    imageUrl: string
  ): string | null {
    if (bytes.byteLength < 32) return null;

    // Magic bytes inspection
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif';
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp';
    }
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp';
    }
    // AVIF / HEIC ftyp box
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }

    // Reject HTML/XML pages masquerading as images
    const headText = new TextDecoder().decode(bytes.subarray(0, 128)).trimStart().toLowerCase();
    if (
      headText.startsWith('<!doctype') ||
      headText.startsWith('<html') ||
      headText.startsWith('<?xml') && !headerMime.includes('svg')
    ) {
      return null;
    }

    if (headerMime.startsWith('image/')) {
      return headerMime;
    }

    if (!headerMime || headerMime === 'application/octet-stream' || headerMime === 'binary/octet-stream') {
      if (/\.png(?:[?#]|$)/i.test(imageUrl)) return 'image/png';
      if (/\.webp(?:[?#]|$)/i.test(imageUrl)) return 'image/webp';
      if (/\.gif(?:[?#]|$)/i.test(imageUrl)) return 'image/gif';
      if (/\.avif(?:[?#]|$)/i.test(imageUrl)) return 'image/avif';
      if (/\.jpe?g(?:[?#]|$)/i.test(imageUrl)) return 'image/jpeg';
    }

    return null;
  }

  private mimeToExtension(mimeType: string): string {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('avif')) return 'avif';
    if (mimeType.includes('svg')) return 'svg';
    return 'jpg';
  }
}
