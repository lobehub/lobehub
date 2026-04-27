// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStore = {
  acquireScopeLock: vi.fn(),
  readWindow: vi.fn(),
  releaseScopeLock: vi.fn(),
  tryDedupe: vi.fn(),
  writeWindow: vi.fn(),
};

describe('agent signal sources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes source events into source nodes', async () => {
    const { buildSource, emitSourceEvent } = await import('..');

    mockStore.tryDedupe.mockResolvedValue(true);
    mockStore.acquireScopeLock.mockResolvedValue(true);
    mockStore.readWindow.mockResolvedValue({ eventCount: '1' });
    mockStore.writeWindow.mockResolvedValue(undefined);
    mockStore.releaseScopeLock.mockResolvedValue(undefined);

    const builtSource = buildSource({
      payload: { operationId: 'op-1', stepIndex: 1, turnCount: 2 },
      scopeKey: 'topic:t1',
      sourceId: 'source_1',
      sourceType: 'runtime.after_step',
      timestamp: 1710000000000,
    });

    expect(builtSource.sourceType).toBe('runtime.after_step');
    expect(builtSource.chain).toEqual({
      chainId: 'chain:source_1',
      rootSourceId: 'source_1',
    });

    const result = await emitSourceEvent(
      {
        payload: { operationId: 'op-1', stepIndex: 1, turnCount: 2 },
        scopeKey: 'topic:t1',
        sourceId: 'source_1',
        sourceType: 'runtime.after_step',
        timestamp: 1710000000000,
      },
      { store: mockStore },
    );

    expect(result.deduped).toBe(false);

    if (result.deduped) throw new Error('Expected generated source result');

    expect(result.source.sourceType).toBe('runtime.after_step');
    expect(result.source.chain).toEqual({
      chainId: 'chain:source_1',
      rootSourceId: 'source_1',
    });
    expect(result.trigger.windowEventCount).toBe(2);
  });
});
