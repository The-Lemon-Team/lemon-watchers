import { describe, it, expect, vi, afterEach } from 'vitest';
import { ArticleExtractorAxon } from '../dist/axons/article-extractor.axon.js';
import { GeminiSparkAxon } from '../dist/axons/gemini-spark.axon.js';
import { WatchersEngine } from '../dist/orchestrator/watchers-engine.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('ArticleExtractorAxon & Original-First Pipeline', () => {
  it('uses feed text directly without scraping when feed text is substantial and complete', async () => {
    global.fetch = vi.fn();
    const extractor = new ArticleExtractorAxon();
    const longFeed = 'Detailed engineering report on distributed consensus and latency reduction. '.repeat(20);

    const res = await extractor.resolveArticleText({
      url: 'https://example.com/post/1',
      feedText: longFeed,
    });

    expect(res.contentOrigin).toBe('feed');
    expect(res.text.length).toBeGreaterThan(1000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('scrapes article webpage via linkedom + Readability when feed has only a teaser', async () => {
    const articleBody = 'This is a full investigative paragraph explaining how the new compiler pipeline eliminates redundant allocations in production workloads. '.repeat(6);
    const html = `<!doctype html>
      <html lang="en">
        <head>
          <title>Compiler Breakthrough - TechBlog</title>
          <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
        </head>
        <body>
          <nav>Home | About | Login</nav>
          <article>
            <h1>Compiler Breakthrough</h1>
            <p>${articleBody}</p>
            <p>Second paragraph with benchmark numbers showing 35% lower memory usage across services.</p>
          </article>
          <footer>Copyright 2026</footer>
        </body>
      </html>`;

    global.fetch = vi.fn().mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );

    const extractor = new ArticleExtractorAxon();
    const res = await extractor.resolveArticleText({
      url: 'https://example.com/compiler-breakthrough',
      feedText: 'Short teaser... Читать далее',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(res.contentOrigin).toBe('scraped');
    expect(res.title).toContain('Compiler Breakthrough');
    expect(res.text).toContain('This is a full investigative paragraph');
    expect(res.text).toContain('35% lower memory usage');
    expect(res.text).not.toContain('Home | About | Login');
    expect(res.pageHtml).toContain('og:image');
  });

  it('falls back to ai_generated when webpage is blocked (403 or Cloudflare wall)', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response('<html><body>Attention Required! | Cloudflare. Enable JavaScript and cookies to continue.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    );

    const extractor = new ArticleExtractorAxon();
    const res = await extractor.resolveArticleText({
      url: 'https://protected.example.com/news',
      feedText: 'Tiny teaser...',
    });

    expect(res.contentOrigin).toBe('ai_generated');
    expect(res.text).toBe('');
  });

  it('preserves original English text in GeminiSparkAxon and translates on LemonBus publish with English in metadata', async () => {
    const originalBody = 'Anthropic published a detailed engineering post on multi-agent evaluation harnesses and deterministic tool replay.';
    const generateText = vi.fn()
      // 1. Metadata enrichment for original English article
      .mockResolvedValueOnce({
        requestId: 'meta-1',
        text: JSON.stringify({
          summary: 'Anthropic shared an engineering post on multi-agent evaluation harnesses.',
          tags: ['ai', 'anthropic', 'evals'],
          resonanceScore: 88,
          icon: '🤖',
          sourceLanguage: 'en',
          coverPrompt: 'Minimalist robotics evaluation grid',
        }),
      })
      // 2. Metadata translation (titleRu + summaryRu) when publishing to LemonBus
      .mockResolvedValueOnce({
        requestId: 'tr-meta-1',
        text: JSON.stringify({
          titleRu: 'Инженерный пост Anthropic о тестировании мультиагентных систем',
          summaryRu: 'Anthropic опубликовала разбор подходов к оценке мультиагентных систем.',
          sourceLanguage: 'en',
        }),
      })
      // 3. Markdown body translation when publishing to LemonBus
      .mockResolvedValueOnce({
        requestId: 'tr-body-1',
        text: '# 🤖 Инженерный пост Anthropic о тестировании мультиагентных систем\n\n> Anthropic опубликовала разбор подходов к оценке мультиагентных систем.\n\n---\n\n## 📌 Подробности события\n\nAnthropic опубликовала подробный инженерный материал о тестировании мультиагентных систем.',
      });

    const spark = new GeminiSparkAxon({
      apiKey: '',
      enabled: true,
      aiStudio: { generateText },
    });

    const payload = await spark.enrichRawFeedItem(
      {
        guid: 'anth-1',
        url: 'https://anthropic.com/engineering/evals',
        title: 'Building multi-agent evals',
        summary: 'Short teaser',
        rawText: originalBody,
        pubDate: '2026-11-18T10:00:00.000Z',
      },
      {
        id: 'w-anthropic',
        slug: 'pub-anthropic-news',
        title: 'Anthropic Engineering',
        description: '',
        category: 'ai',
        feedSlug: 'spark-ai',
        url: 'https://anthropic.com/rss',
        protocol: 'atom',
        pollIntervalSeconds: 900,
        defaultTags: ['ai'],
        enabled: true,
      },
      {
        contentOrigin: 'scraped',
        originalText: originalBody,
        sourceLangHint: 'en',
      }
    );

    // Local Lemon-Watchers article stays in English with intact original body
    expect(payload.title).toBe('Building multi-agent evals');
    expect(payload.rawContent).toContain(originalBody);
    expect(payload.metadata.contentOrigin).toBe('scraped');
    expect(payload.metadata.sourceLanguage).toBe('en');
    expect(payload.metadata.translationStatus).toBe('original');

    // Now test publishArticleToBus translation behavior keeping English in metadata
    const storedArticle = {
      id: payload.id,
      watcherId: 'w-anthropic',
      watcherSlug: 'pub-anthropic-news',
      watcherTitle: 'Anthropic Engineering',
      category: 'ai',
      guid: 'anth-1',
      url: 'https://anthropic.com/engineering/evals',
      title: payload.title,
      summary: payload.summary,
      content: payload.rawContent,
      author: 'Anthropic Engineering',
      tags: payload.tags,
      resonanceScore: payload.resonanceScore,
      contentHash: 'hash-1',
      publishedAt: payload.eventDate,
      rawPayload: payload.metadata,
      createdAt: '2026-11-18T10:05:00.000Z',
    };

    const publishSpy = vi.fn().mockResolvedValue(true);
    const fakeEngine = {
      config: { busModerationMode: true },
      db: {
        getItemById: vi.fn().mockResolvedValue(storedArticle),
        markItemPublishedToBus: vi.fn().mockResolvedValue({ ...storedArticle, busPublishedAt: '2026-11-18T10:10:00.000Z' }),
      },
      gemini: spark,
      busRelay: { publishArticleToBus: publishSpy },
      addStoryItem: vi.fn(),
      prepareArticleForBus: WatchersEngine.prototype['prepareArticleForBus'],
    };

    await WatchersEngine.prototype.publishArticleToBus.call(fakeEngine, payload.id);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const sentToBus = publishSpy.mock.calls[0][0];
    expect(sentToBus.title).toBe('Инженерный пост Anthropic о тестировании мультиагентных систем');
    expect(sentToBus.content).toContain('подробный инженерный материал');
    expect(sentToBus.rawPayload.originalTitle).toBe('Building multi-agent evals');
    expect(sentToBus.rawPayload.originalContent).toContain(originalBody);
    expect(sentToBus.rawPayload.sourceLanguage).toBe('en');
    expect(sentToBus.rawPayload.translationStatus).toBe('translated');
  });
});
