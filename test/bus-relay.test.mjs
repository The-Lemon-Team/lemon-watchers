import { describe, it, expect, vi } from 'vitest';
import { BusRelayAxon } from '../dist/axons/bus-relay.axon.js';

describe('BusRelayAxon', () => {
  it('formats autonomous WATCHER_ITEM event correctly', async () => {
    let capturedBody = null;
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, statusText: 'OK' };
    });

    const relay = new BusRelayAxon({
      busUrl: 'http://127.0.0.1:3030',
      deviceId: 'test-device',
    });

    const testItem = {
      id: 'test-item-123',
      watcherId: 'w-habr-best',
      watcherSlug: 'pub-habr-best',
      watcherTitle: 'Хабр — Лучшие статьи',
      category: 'habr',
      guid: 'habr:post:99999',
      url: 'https://habr.com/ru/post/99999',
      title: 'Тестовая статья о технологиях',
      summary: 'Краткое содержание статьи',
      content: '<p>Полный текст</p>',
      author: 'Анонимный разработчик',
      tags: ['habr', 'it', 'tech'],
      resonanceScore: 88,
      contentHash: 'hash-abc-123',
      publishedAt: '2026-11-09T10:00:00.000Z',
      createdAt: '2026-11-09T10:01:00.000Z',
    };

    const success = await relay.publishCollectedItemToBus(testItem);

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:3030/events', expect.any(Object));
    expect(capturedBody).toMatchObject({
      entityType: 'WATCHER_ITEM',
      action: 'COLLECTED',
      category: 'habr',
      watcherSlug: 'pub-habr-best',
      deviceId: 'test-device',
      payload: {
        id: 'test-item-123',
        title: 'Тестовая статья о технологиях',
        resonanceScore: 88,
        tags: ['habr', 'it', 'tech'],
      },
    });
  });
});
