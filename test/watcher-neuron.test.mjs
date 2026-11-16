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

    const pingResult = await neuron.poll();

    expect(pingResult.statusCode).toBe(409);
    expect(pingResult.error).toContain('Mutex Guard inactive');
    expect(mockDb.recordPing).not.toHaveBeenCalled();
    expect(mockDb.updateWatcherState).not.toHaveBeenCalled();
  });

  it('registers composite neuron with 6 flows in Core Combinator on start()', async () => {
    const ensureCompositeNeuron = vi.fn().mockResolvedValue({
      neuron: { id: 'folder-cybersec-123', path: 'watchers.news.cybersec_feed' },
      flows: {
        context: { id: 'flow-ctx-1' },
        circuitBreaker: { id: 'flow-cb-1' },
        timer: { id: 'flow-timer-1' },
        mutex: { id: 'flow-mutex-1' },
        batch: { id: 'flow-batch-1' },
        observer: { id: 'flow-obs-1' },
      },
    });

    const subscribeMock = vi.fn().mockReturnValue(() => {});

    const mockCombinator = {
      neurons: { ensureCompositeNeuron },
      stream: { subscribe: subscribeMock },
      acquireLease: vi.fn(),
      chronicle: { recordSuccess: vi.fn(), recordFailure: vi.fn(), recordMetric: vi.fn() },
      batch: { pushMany: vi.fn() },
    };

    const neuron = new WatcherNeuron({
      config: {
        id: 'cybersec-1',
        slug: 'cybersec-feed',
        title: 'CyberSec Bulletin',
        url: 'https://example.com/cyber.xml',
        protocol: 'rss',
        category: 'cybersec',
        pollIntervalSeconds: 120,
        enabled: true,
      },
      initialState: {
        id: 'cybersec-1',
        slug: 'cybersec-feed',
        enabled: true,
        status: 'IDLE',
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
      db: { recordPing: vi.fn(), updateWatcherState: vi.fn() },
      gemini: {},
      busRelay: {},
      combinator: mockCombinator,
    });

    await neuron.start();

    expect(ensureCompositeNeuron).toHaveBeenCalledTimes(1);
    const callArg = ensureCompositeNeuron.mock.calls[0][0];
    expect(callArg.name).toBe('CyberSec Bulletin');
    expect(callArg.path).toBe('watchers.news.cybersec_feed');
    expect(callArg.flows.circuitBreaker).toBeDefined();
    expect(callArg.flows.mutex.gate).toEqual({ requireCircuitBreaker: 'CLOSED' });
    expect(callArg.flows.timer.intervalSeconds).toBe(120);

    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: 'folder-cybersec-123',
        impulseType: 'TIMER_TICK',
      }),
      expect.any(Function),
    );

    neuron.stop();
  });

  it('blocks poll with 423 when Core Combinator Activation Gate rejects lease', async () => {
    const mockLeaseRelease = vi.fn();
    const mockCombinator = {
      neurons: {
        ensureCompositeNeuron: vi.fn().mockResolvedValue({
          neuron: { id: 'folder-ai-1' },
          flows: {
            mutex: { id: 'mutex-flow-ai' },
            circuitBreaker: { id: 'cb-flow-ai' },
          },
        }),
      },
      stream: { subscribe: vi.fn().mockReturnValue(() => {}) },
      acquireLease: vi.fn().mockRejectedValue(
        new Error('Activation Gate blocked flow: expected CLOSED, found OPEN'),
      ),
      chronicle: { recordSuccess: vi.fn(), recordFailure: vi.fn(), recordMetric: vi.fn() },
      batch: { pushMany: vi.fn() },
    };

    const neuron = new WatcherNeuron({
      config: {
        id: 'ai-1',
        slug: 'ai-front',
        title: 'AI Frontier',
        url: 'https://example.com/ai.xml',
        protocol: 'atom',
        category: 'ai',
        pollIntervalSeconds: 60,
        enabled: true,
      },
      initialState: {
        id: 'ai-1',
        slug: 'ai-front',
        enabled: true,
        status: 'IDLE',
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
      db: { recordPing: vi.fn(), updateWatcherState: vi.fn() },
      gemini: {},
      busRelay: {},
      combinator: mockCombinator,
    });

    await neuron.start();

    const result = await neuron.poll();

    expect(result.statusCode).toBe(423);
    expect(result.id).toBe('gate-blocked');
    expect(result.error).toContain('Core Combinator Gate blocked');
    expect(mockCombinator.acquireLease).toHaveBeenCalledWith('mutex-flow-ai', expect.any(Object));

    neuron.stop();
  });
});
