import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Subject } from 'rxjs';
import { WatchersNestServer } from '../dist/nest/watchers-nest.server.js';
import { stripHtmlToTeaser, toStreamNewsItem } from '../dist/types/stream-news.types.js';

describe('NestJS Watchers Server & Reactive Streams API', () => {
  let server;
  let baseUrl;
  let streamEvents$;
  let mockEngine;

  beforeAll(async () => {
    streamEvents$ = new Subject();

    const replayEvents = [
      {
        id: 'ev-ai-1',
        type: 'news_item',
        timestamp: '2026-11-18T10:00:00.000Z',
        category: 'ai',
        watcherId: 'w-ai-1',
        watcherSlug: 'pub-anthropic-news',
        item: {
          id: 'raw-1',
          watcherId: 'w-ai-1',
          watcherSlug: 'pub-anthropic-news',
          watcherTitle: 'Anthropic News',
          category: 'ai',
          feedSlug: 'spark-ai',
          guid: 'guid-1',
          url: 'https://anthropic.com/1',
          title: 'Claude Update',
          teaser: 'Short teaser',
          imageUrl: null,
          author: 'Anthropic',
          pubDate: '2026-11-18T10:00:00.000Z',
          categories: ['ai'],
          status: 'NEW',
          noteId: null,
          createdAt: '2026-11-18T10:00:00.000Z',
        },
      },
      {
        id: 'ev-habr-1',
        type: 'news_item',
        timestamp: '2026-11-18T10:01:00.000Z',
        category: 'habr',
        watcherId: 'w-habr-1',
        watcherSlug: 'pub-habr-best',
        item: {
          id: 'raw-2',
          watcherId: 'w-habr-1',
          watcherSlug: 'pub-habr-best',
          watcherTitle: 'Habr Best',
          category: 'habr',
          feedSlug: 'spark-habr',
          guid: 'guid-2',
          url: 'https://habr.com/2',
          title: 'Habr Post',
          teaser: 'Habr teaser',
          imageUrl: null,
          author: 'Habr',
          pubDate: '2026-11-18T10:01:00.000Z',
          categories: ['habr'],
          status: 'NEW',
          noteId: null,
          createdAt: '2026-11-18T10:01:00.000Z',
        },
      },
    ];

    mockEngine = {
      streamEvents$,
      sse: { addClient: vi.fn(), count: () => 0 },
      getMetrics: vi.fn().mockResolvedValue({ activeWatchers: 5, totalWatchers: 5 }),
      getRecentStory: vi.fn().mockReturnValue([]),
      getBusMetrics: vi.fn().mockResolvedValue({ total: 0, published: 0, pending: 0 }),
      getFolders: vi.fn().mockResolvedValue([]),
      getAllWatchers: vi.fn().mockReturnValue([]),
      getStreamItems: vi.fn().mockResolvedValue({
        items: [replayEvents[0].item],
        total: 1,
        limit: 25,
        offset: 0,
        counts: { newCount: 1, promotedCount: 0, dismissedCount: 0, totalCount: 1 },
      }),
      getStreamReplay: vi.fn().mockImplementation(({ categories }) => {
        if (!categories?.length) return replayEvents;
        return replayEvents.filter((e) => categories.includes(e.category));
      }),
      matchesStreamFilter: vi.fn().mockImplementation((ev, filter) => {
        if (filter.types?.size && !filter.types.has(ev.type)) return false;
        if (filter.categories?.size && !filter.categories.has(ev.category)) return false;
        if (filter.watchers?.size && !filter.watchers.has(ev.watcherSlug)) return false;
        return true;
      }),
      promoteStreamItem: vi.fn().mockImplementation(async (id) => {
        if (id === 'missing') return null;
        return {
          article: { id: 'art-1', title: 'Promoted Note' },
          item: { ...replayEvents[0].item, id, status: 'PROMOTED', noteId: 'art-1' },
        };
      }),
      promoteBatchStreamItems: vi.fn().mockResolvedValue({ count: 1, articles: [{ id: 'art-1' }] }),
      dismissStreamItems: vi.fn().mockImplementation(async (ids) => {
        if (ids.includes('missing')) return { count: 0, items: [] };
        return {
          count: ids.length,
          items: ids.map((id) => ({ ...replayEvents[0].item, id, status: 'DISMISSED' })),
        };
      }),
      pruneExpiredRawNews: vi.fn().mockResolvedValue({ pruned: 12, ttlHours: 48 }),
    };

    server = new WatchersNestServer(0, mockEngine);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.getPort()}`;
  });

  afterAll(async () => {
    await server.stop();
    streamEvents$.complete();
  });

  it('serves /health endpoint via NestJS', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('lemon-watchers');
  });

  it('queries lightweight stream items with csv filters', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/streams/items?categories=ai,cybersec&status=NEW&limit=10&offset=0`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(mockEngine.getStreamItems).toHaveBeenCalledWith({
      categories: ['ai', 'cybersec'],
      watchers: undefined,
      status: 'NEW',
      search: undefined,
      limit: 10,
      offset: 0,
    });
  });

  it('promotes, dismisses, and prunes stream items', async () => {
    const promoteRes = await fetch(`${baseUrl}/api/v1/streams/items/raw-1/promote`, {
      method: 'POST',
    });
    expect(promoteRes.status).toBe(200);
    const promoteBody = await promoteRes.json();
    expect(promoteBody.item.status).toBe('PROMOTED');
    expect(promoteBody.article.id).toBe('art-1');

    const dismissRes = await fetch(`${baseUrl}/api/v1/streams/items/raw-1/dismiss`, {
      method: 'POST',
    });
    expect(dismissRes.status).toBe(200);
    const dismissBody = await dismissRes.json();
    expect(dismissBody.item.status).toBe('DISMISSED');

    const missingDismissRes = await fetch(`${baseUrl}/api/v1/streams/items/missing/dismiss`, {
      method: 'POST',
    });
    expect(missingDismissRes.status).toBe(404);

    const pruneRes = await fetch(`${baseUrl}/api/v1/streams/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttlHours: 48 }),
    });
    expect(pruneRes.status).toBe(200);
    expect(await pruneRes.json()).toEqual({ pruned: 12, ttlHours: 48 });
  });

  it('streams filtered replay and live news events over SSE', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/v1/streams/live?categories=ai&replay=10`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Read replay chunk
    while (!buffer.includes('ev-ai-1')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    expect(buffer).toContain('ev-ai-1');
    expect(buffer).not.toContain('ev-habr-1');

    // Emit one filtered-out habr event and one matching ai event
    streamEvents$.next({
      id: 'ev-habr-live',
      type: 'news_item',
      timestamp: '2026-11-18T10:05:00.000Z',
      category: 'habr',
      watcherSlug: 'pub-habr-best',
      item: { id: 'raw-habr-live', category: 'habr', title: 'Ignored Habr' },
    });

    streamEvents$.next({
      id: 'ev-ai-live',
      type: 'news_item',
      timestamp: '2026-11-18T10:06:00.000Z',
      category: 'ai',
      watcherSlug: 'pub-anthropic-news',
      item: { id: 'raw-ai-live', category: 'ai', title: 'Live AI News' },
    });

    while (!buffer.includes('ev-ai-live')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    controller.abort();

    expect(buffer).toContain('ev-ai-live');
    expect(buffer).toContain('Live AI News');
    expect(buffer).not.toContain('ev-habr-live');
  });

  it('strips HTML into clean teaser for lightweight StreamNewsItem', () => {
    const teaser = stripHtmlToTeaser('<p>Hello <b>world</b> &amp; <i>stream</i>!</p>', 50);
    expect(teaser).toBe('Hello world & stream!');

    const streamItem = toStreamNewsItem({
      id: 'r1',
      watcherId: 'w1',
      guid: 'g1',
      url: 'https://example.com',
      title: 'Test Title',
      description: '<div>Some <strong>HTML</strong> teaser</div>',
      contentRaw: 'Huge raw body that should not bloat teaser',
      author: 'Author',
      pubDate: '2026-11-18T10:00:00.000Z',
      categories: ['ai'],
      contentHash: 'hash',
      status: 'PENDING',
      createdAt: '2026-11-18T10:00:00.000Z',
    }, { watcherSlug: 'pub-ai', watcherTitle: 'AI Feed', category: 'ai', feedSlug: 'spark-ai' });

    expect(streamItem.status).toBe('NEW');
    expect(streamItem.teaser).toBe('Some HTML teaser');
    expect(streamItem.contentRaw).toBeUndefined();
  });
});
