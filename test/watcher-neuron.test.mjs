import { describe, it, expect, vi } from 'vitest';
import { WatcherNeuron } from '../dist/neurons/watcher.neuron.js';

describe('WatcherNeuron Mutex & Activation Guard', () => {
  it('returns status 409 disabled when poll() is called on paused watcher', async () => {
    const mockDb = {
      recordPing: vi.fn(),
      updateWatcherState: vi.fn(),
    };
    const mockGemini = {};
    const mockBus = {};

    const neuron = new WatcherNeuron({
      config: {
        id: 'test-watcher-1',
        slug: 'test-slug',
        title: 'Test',
        url: 'https://example.com/rss',
        protocol: 'rss',
        category: 'ai',
        pollIntervalSeconds: 60,
        enabled: false,
      },
      initialState: {
        id: 'test-watcher-1',
        slug: 'test-slug',
        enabled: false,
        status: 'PAUSED',
        lastPingAt: null,
        lastSuccessAt: null,
        lastError: null,
        etag: null,
        lastModified: null,
        consecutiveFailures: 0,
        totalPings: 0,
        totalItemsIngested: 0,
        lastLatencyMs: 0,
      },
      db: mockDb,
      gemini: mockGemini,
      busRelay: mockBus,
    });

    // Calling poll when watcher is disabled should NOT invoke db.recordPing
    const pingResult = await neuron.poll();

    expect(pingResult.statusCode).toBe(409);
    expect(pingResult.error).toContain('Mutex Guard inactive');
    expect(mockDb.recordPing).not.toHaveBeenCalled();
    expect(mockDb.updateWatcherState).not.toHaveBeenCalled();
  });
});
