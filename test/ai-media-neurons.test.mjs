import { describe, it, expect, vi, afterEach } from 'vitest';
import { GeminiSparkAxon } from '../dist/axons/gemini-spark.axon.js';
import { MediaCoverAxon } from '../dist/axons/media-cover.axon.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('GeminiSparkAxon & MediaCoverAxon with AI/Media Neurons', () => {
  it('uses AiStudioAxon for Spark enrichment and returns coverPrompt', async () => {
    const generateText = vi.fn().mockResolvedValue({
      requestId: 'ai-req-1',
      text: JSON.stringify({
        titleRu: 'Новый релиз реактивного ядра',
        summaryRu: 'Команда выпустила обновление нейронов.',
        bodyMarkdownRu: 'Подробный разбор архитектуры и улучшений.',
        tags: ['#ai', 'jmdaily', 'neurons'],
        resonanceScore: 84,
        icon: '🚀',
        sourceLanguage: 'en',
        coverPrompt: 'Glowing lemon reactive neural network, clean editorial illustration',
      }),
    });

    const spark = new GeminiSparkAxon({
      apiKey: '',
      enabled: true,
      aiStudio: { generateText },
    });

    const payload = await spark.enrichRawFeedItem(
      {
        guid: 'g-1',
        url: 'https://example.com/news/1',
        title: 'New reactive core release',
        summary: 'Team released neuron updates',
        pubDate: '2026-11-16T00:00:00.000Z',
      },
      {
        id: 'w-1',
        slug: 'pub-ai',
        title: 'AI Feed',
        description: '',
        category: 'ai',
        feedSlug: 'spark-ai',
        url: 'https://example.com/rss',
        protocol: 'rss',
        pollIntervalSeconds: 600,
        defaultTags: ['tech'],
        enabled: true,
      }
    );

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(payload.title).toBe('Новый релиз реактивного ядра');
    expect(payload.tags).toEqual(['tech', 'ai', 'neurons']);
    expect(payload.tags).not.toContain('jmdaily');
    expect(payload.metadata.enrichedBy).toBe('lemon-ai-service');
    expect(payload.metadata.coverPrompt).toContain('Glowing lemon');
  });

  it('generates cover image via AiStudioAxon and resolves URL via MediaLifecycleAxon', async () => {
    const generateImages = vi.fn().mockResolvedValue({
      requestId: 'img-req-1',
      synthesizedPrompt: 'Clean editorial illustration',
      model: 'imagen-3',
      isFallback: false,
      folderPath: 'covers',
      items: [
        {
          id: 'asset-99',
          url: '/uploads/media/asset-99.webp',
          thumbnailUrl: '/uploads/thumbs/asset-99.webp',
        },
      ],
    });

    const mediaCover = new MediaCoverAxon({
      enabled: true,
      aiStudio: { generateImages },
      mediaHub: {
        apiClient: {
          baseUrl: 'http://127.0.0.1:3005',
          resolveUrl: (u) => `http://127.0.0.1:3005${u.startsWith('/') ? u : '/' + u}`,
        },
      },
    });

    const cover = await mediaCover.generateCoverForArticle({
      id: 'art-1',
      title: 'Тестовая новость',
      summary: 'Описание новости',
      category: 'ai',
      tags: ['ai'],
    });

    expect(generateImages).toHaveBeenCalledTimes(1);
    expect(cover).toMatchObject({
      coverUrl: 'http://127.0.0.1:3005/uploads/media/asset-99.webp',
      coverThumbnailUrl: 'http://127.0.0.1:3005/uploads/thumbs/asset-99.webp',
      coverAssetId: 'asset-99',
      model: 'imagen-3',
    });
  });

  it('prefers original news cover, saves it via MediaLifecycleAxon.addMedia (MediaIngestFlow), and resolves via viewMedia (MediaViewFlow)', async () => {
    // Valid PNG magic bytes + padding (>= 32 bytes)
    const pngBytes = new Uint8Array(64);
    pngBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);

    global.fetch = vi.fn().mockResolvedValue(
      new Response(pngBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const addMedia = vi.fn().mockResolvedValue({
      asset: {
        id: 'orig-asset-1',
        url: '/api/media/orig-asset-1/file/full',
        thumbnailUrl: '/api/media/orig-asset-1/file/thumb',
      },
      waitedForProcessing: false,
      elapsedMs: 12,
    });
    const viewMedia = vi.fn().mockResolvedValue({
      asset: {
        id: 'orig-asset-1',
        url: '/api/media/orig-asset-1/file/full',
        thumbnailUrl: '/api/media/orig-asset-1/file/thumb',
      },
      variant: 'full',
      url: 'http://127.0.0.1:3005/api/media/orig-asset-1/file/full',
      relativeUrl: '/api/media/orig-asset-1/file/full',
      signed: false,
    });
    const generateImages = vi.fn();

    const mediaCover = new MediaCoverAxon({
      enabled: true,
      aiStudio: { generateImages },
      mediaHub: {
        apiClient: {
          baseUrl: 'http://127.0.0.1:3005',
          resolveUrl: (u) => `http://127.0.0.1:3005${u.startsWith('/') ? u : '/' + u}`,
          fetchAssetStream: vi.fn(),
        },
        addMedia,
        viewMedia,
      },
    });

    const cover = await mediaCover.resolveArticleCover({
      id: 'art-orig-1',
      title: 'Оригинальная новость',
      category: 'ai',
      tags: ['news'],
      externalImageUrl: 'https://news.example.com/images/hero.png',
      articleUrl: 'https://news.example.com/post/1',
    });

    expect(generateImages).not.toHaveBeenCalled();
    expect(addMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: 'covers',
        visibility: 'PUBLIC',
        dedupKey: 'https://news.example.com/images/hero.png',
        mimeType: 'image/png',
      })
    );
    expect(viewMedia).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'orig-asset-1' })
    );
    expect(cover).toMatchObject({
      coverUrl: 'http://127.0.0.1:3005/api/media/orig-asset-1/file/full',
      coverThumbnailUrl: 'http://127.0.0.1:3005/api/media/orig-asset-1/file/thumb',
      coverAssetId: 'orig-asset-1',
      source: 'original',
      originalImageUrl: 'https://news.example.com/images/hero.png',
    });
  });

  it('scrapes og:image from article page when feed has no imageUrl, and falls back to AI when original image fails', async () => {
    const mediaCover = new MediaCoverAxon({
      enabled: true,
      aiStudio: {
        generateImages: vi.fn().mockResolvedValue({
          requestId: 'ai-fallback-1',
          model: 'imagen-3',
          isFallback: false,
          items: [{ id: 'ai-asset-1', url: '/api/media/ai-asset-1/file/full', thumbnailUrl: '/api/media/ai-asset-1/file/thumb' }],
        }),
      },
      mediaHub: {
        apiClient: {
          baseUrl: 'http://127.0.0.1:3005',
          resolveUrl: (u) => `http://127.0.0.1:3005${u.startsWith('/') ? u : '/' + u}`,
        },
        addMedia: vi.fn(),
        viewMedia: vi.fn(),
      },
    });

    // 1. Verify HTML og:image extraction (both attribute orders + relative URL resolution)
    const html = `<html><head><meta content="/media/og-cover.jpg" property="og:image" /></head></html>`;
    expect(mediaCover.extractOriginalImageFromHtml(html, 'https://example.org/news/42')).toBe(
      'https://example.org/media/og-cover.jpg'
    );

    // 2. Verify fallback to AI when article page returns 404 and no externalImageUrl is present
    global.fetch = vi.fn().mockResolvedValue(new Response('Not found', { status: 404 }));
    const fallbackCover = await mediaCover.resolveArticleCover({
      id: 'art-fallback-1',
      title: 'Новость без картинки',
      articleUrl: 'https://example.org/news/404',
    });

    expect(fallbackCover).toMatchObject({
      coverUrl: 'http://127.0.0.1:3005/api/media/ai-asset-1/file/full',
      coverAssetId: 'ai-asset-1',
      source: 'ai',
    });
  });

  it('loads stored cover stream via MediaViewFlow + MediaHubApiClient.fetchAssetStream', async () => {
    const viewMedia = vi.fn().mockResolvedValue({
      asset: { id: 'asset-55' },
      variant: 'full',
      url: 'http://127.0.0.1:3005/api/media/asset-55/file/full',
      relativeUrl: '/api/media/asset-55/file/full',
      signed: false,
    });
    const fetchAssetStream = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      })
    );

    const mediaCover = new MediaCoverAxon({
      enabled: true,
      mediaHub: {
        apiClient: {
          baseUrl: 'http://127.0.0.1:3005',
          resolveUrl: (u) => `http://127.0.0.1:3005${u}`,
          fetchAssetStream,
        },
        viewMedia,
      },
    });

    const loaded = await mediaCover.fetchCoverStream('asset-55');
    expect(viewMedia).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-55' })
    );
    expect(fetchAssetStream).toHaveBeenCalledWith('asset-55', 'full');
    expect(loaded?.contentType).toBe('image/webp');
  });
});
