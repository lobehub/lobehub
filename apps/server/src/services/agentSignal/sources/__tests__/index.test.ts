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

  it('carries the selfIteration payload through the agent.execution.completed renderer', async () => {
    const { buildSource } = await import('..');

    // Compact completion payload the CompletionLifecycle attaches; the renderer
    // rebuilds the payload from an allow-list, so this field is the one that
    // regressed — it MUST survive for the completion policy to project receipts.
    const selfIteration = {
      artifacts: [],
      marker: { kind: 'memory', sourceId: 'src_1', topicId: 'topic_1' },
      mutations: [
        { apiName: 'writeMemory', data: { kind: 'mutation', status: 'applied' }, kind: 'mutation' },
      ],
      userId: 'user_1',
    };

    const built = buildSource({
      payload: { agentId: 'agent_1', operationId: 'op_1', selfIteration, topicId: 'topic_1' },
      scopeKey: 'topic:topic_1',
      sourceId: 'op_1:complete:done',
      sourceType: 'agent.execution.completed',
      timestamp: 1_710_000_000_000,
    });

    expect(built.sourceType).toBe('agent.execution.completed');
    expect(built.payload.selfIteration).toEqual(selfIteration);
  });
});
