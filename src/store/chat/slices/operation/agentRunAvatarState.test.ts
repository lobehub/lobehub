import { describe, expect, it } from 'vitest';

import { type ChatStoreState } from '../../initialState';
import { topicMapKey } from '../../utils/topicMapKey';
import { agentRunAvatarState, isLatestAgentRunCompleted } from './agentRunAvatarState';
import type { Operation } from './types';

const op = (
  id: string,
  type: Operation['type'],
  overrides: {
    agentId?: string;
    metadata?: Record<string, unknown>;
    status?: Operation['status'];
    topicId?: string;
  } = {},
) =>
  ({
    context: { agentId: overrides.agentId ?? 'agent', topicId: overrides.topicId },
    id,
    metadata: { startTime: 1, ...overrides.metadata },
    status: overrides.status ?? 'running',
    type,
  }) as unknown as Operation;

const store = (ops: Operation[], topics: { id: string; status: string }[] = []) => {
  const operationsByType: Record<string, string[]> = {};
  for (const item of ops) (operationsByType[item.type] ??= []).push(item.id);
  return {
    operations: Object.fromEntries(ops.map((item) => [item.id, item])),
    operationsByType,
    topicDataMap: { [topicMapKey({ agentId: 'agent' })]: { items: topics } },
  } as unknown as ChatStoreState;
};

describe('agentRunAvatarState', () => {
  it('is idle without a visible run', () => {
    expect(agentRunAvatarState('agent')(store([]))).toBeUndefined();
    expect(
      agentRunAvatarState('agent')(
        store([op('a', 'execAgentRuntime', { metadata: { visibleLoadingDone: true } })]),
      ),
    ).toBeUndefined();
    expect(
      agentRunAvatarState('agent')(
        store([op('a', 'execAgentRuntime', { metadata: { isAborting: true } })]),
      ),
    ).toBeUndefined();
  });

  it('ignores the runs of other agents', () => {
    expect(
      agentRunAvatarState('agent')(store([op('a', 'execAgentRuntime', { agentId: 'other' })])),
    ).toBeUndefined();
  });

  it.each(['execAgentRuntime', 'execHeterogeneousAgent', 'execServerAgentRuntime'] as const)(
    'works during %s',
    (type) => {
      expect(agentRunAvatarState('agent')(store([op('a', type)]))).toBe('working');
    },
  );

  it('thinks while the run reasons', () => {
    expect(
      agentRunAvatarState('agent')(store([op('a', 'execAgentRuntime'), op('b', 'reasoning')])),
    ).toBe('thinking');
  });

  it('is blocked while a topic waits for a person', () => {
    expect(agentRunAvatarState('agent')(store([], [{ id: 't', status: 'waitingForHuman' }]))).toBe(
      'blocked',
    );
  });

  it('reads a run paused on a person as blocked, not working', () => {
    expect(
      agentRunAvatarState('agent')(
        store(
          [op('a', 'execServerAgentRuntime', { topicId: 't' })],
          [{ id: 't', status: 'waitingForHuman' }],
        ),
      ),
    ).toBe('blocked');
  });

  it('keeps working when another topic is the one waiting', () => {
    expect(
      agentRunAvatarState('agent')(
        store(
          [op('a', 'execAgentRuntime', { topicId: 'busy' })],
          [{ id: 'other', status: 'waitingForHuman' }],
        ),
      ),
    ).toBe('working');
  });
});

describe('isLatestAgentRunCompleted', () => {
  it('follows the newest run', () => {
    const older = op('a', 'execAgentRuntime', { metadata: { startTime: 1 }, status: 'failed' });
    const newer = op('b', 'execAgentRuntime', { metadata: { startTime: 2 }, status: 'completed' });
    expect(isLatestAgentRunCompleted('agent')(store([older, newer]))).toBe(true);
  });

  it.each(['failed', 'cancelled'] as const)('is false for a %s run', (status) => {
    expect(
      isLatestAgentRunCompleted('agent')(store([op('a', 'execAgentRuntime', { status })])),
    ).toBe(false);
  });

  it('is false for a run stopped elsewhere, which is stored as completed', () => {
    const stopped = op('a', 'execServerAgentRuntime', {
      metadata: { endedWithoutCompletion: true },
      status: 'completed',
    });
    expect(isLatestAgentRunCompleted('agent')(store([stopped]))).toBe(false);
  });

  it('is false without runs', () => {
    expect(isLatestAgentRunCompleted('agent')(store([]))).toBe(false);
  });
});
