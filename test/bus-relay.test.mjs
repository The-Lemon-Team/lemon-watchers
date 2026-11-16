import { describe, it, expect, vi } from 'vitest';
import { BusRelayAxon } from '../dist/axons/bus-relay.axon.js';

describe('BusRelayAxon', () => {
  it('submits NOTE as PROPOSE with PENDING_MODERATION and cover metadata by default', async () => {
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
      coverUrl: 'http://127.0.0.1:3005/uploads/media/cover-1.webp',
      coverThumbnailUrl: 'http://127.0.0.1:3005/uploads/thumbs/cover-1.webp',
      coverAssetId: 'asset-cover-1',
      createdAt: '2026-11-09T10:01:00.000Z',
    };

    const success = await relay.publishCollectedItemToBus(testItem);

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('http://127.0.0.1:3030/events', expect.any(Object));
    expect(capturedBody).toMatchObject({
      entityType: 'NOTE',
      action: 'PROPOSE',
      category: 'habr',
      watcherSlug: 'pub-habr-best',
      deviceId: 'test-device',
      payload: {
        id: 'test-item-123',
        title: 'Тестовая статья о технологиях',
        status: 'PENDING_MODERATION',
        category: 'habr',
        coverImage: 'http://127.0.0.1:3005/uploads/media/cover-1.webp',
        resonanceScore: 88,
        hashtags: ['habr', 'it', 'tech'],
        metadata: {
          coverUrl: 'http://127.0.0.1:3005/uploads/media/cover-1.webp',
          coverAssetId: 'asset-cover-1',
          moderationRequired: true,
        },
      },
    });
  });

  it('supports direct UPSERT / PUBLISHED when moderationMode is false', async () => {
    let capturedBody = null;
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, statusText: 'OK' };
    });

    const relay = new BusRelayAxon({
      busUrl: 'http://127.0.0.1:3030',
      deviceId: 'test-device',
      moderationMode: false,
    });

    const success = await relay.publishArticleToBus({
      id: 'test-item-456',
      watcherId: 'w-ai',
      watcherSlug: 'pub-ai',
      category: 'ai',
      guid: 'ai:1',
      url: 'https://example.com/ai/1',
      title: 'Direct Note',
      summary: 'Summary',
      content: 'Body',
      author: 'AI',
      tags: ['ai'],
      resonanceScore: 70,
      contentHash: 'hash-456',
      publishedAt: '2026-11-09T10:00:00.000Z',
      createdAt: '2026-11-09T10:01:00.000Z',
    });

    expect(success).toBe(true);
    expect(capturedBody.action).toBe('UPSERT');
    expect(capturedBody.payload.status).toBe('PUBLISHED');
  });
});
