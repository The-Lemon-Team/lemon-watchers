import { describe, it, expect, vi } from 'vitest';
import { GeminiSparkAxon } from '../dist/axons/gemini-spark.axon.js';
import { MediaCoverAxon } from '../dist/axons/media-cover.axon.js';

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
});
