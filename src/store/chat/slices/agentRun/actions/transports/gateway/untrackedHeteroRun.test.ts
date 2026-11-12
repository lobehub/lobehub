import { afterEach, describe, expect, it, vi } from 'vitest';

import { topicSelectors } from '@/store/chat/selectors';

import {
  findUntrackedHeteroMarker,
  noteServerIdleMarker,
  reattachUntrackedHeteroRun,
  resetServerIdleMarkers,
} from './untrackedHeteroRun';

const context = { agentId: 'agt-1', threadId: null, topicId: 'tpc-1' };

const makeGet = (params: { heteroType?: string | null; operations?: Record<string, any> }) => {
  const reconnectToGatewayOperation = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(topicSelectors, 'getTopicById').mockReturnValue(
    () =>
      ({
        id: 'tpc-1',
        metadata: {
          runningOperation: {
            assistantMessageId: 'msg-1',
            heteroType: params.heteroType,
            operationId: `op-${params.heteroType}`,
          },
        },
      }) as any,
  );
  const state = { operations: params.operations ?? {}, reconnectToGatewayOperation };
  return { get: () => state as any, reconnectToGatewayOperation };
};

afterEach(() => {
  resetServerIdleMarkers();
  vi.restoreAllMocks();
});

describe('findUntrackedHeteroMarker', () => {
  it('finds a hetero marker no local operation follows, without side effects', () => {
    const { get, reconnectToGatewayOperation } = makeGet({ heteroType: 'claude-code' });

    expect(findUntrackedHeteroMarker(get, context)?.operationId).toBe('op-claude-code');
    expect(reconnectToGatewayOperation).not.toHaveBeenCalled();
  });

  it('leaves a run this tab follows to the composer predicate', () => {
    const { get } = makeGet({
      heteroType: 'codex',
      operations: {
        local: {
          metadata: { serverOperationId: 'op-codex', visibleLoadingDone: true },
          status: 'running',
          type: 'execServerAgentRuntime',
        },
      },
    });

    expect(findUntrackedHeteroMarker(get, context)).toBeUndefined();
  });

  it('ignores markers of ordinary server runs and thread conversations', () => {
    expect(findUntrackedHeteroMarker(makeGet({ heteroType: null }).get, context)).toBeUndefined();
    const { get } = makeGet({ heteroType: 'claude-code' });
    expect(findUntrackedHeteroMarker(get, { ...context, threadId: 'thd-1' })).toBeUndefined();
  });

  it('stops finding a marker once the server found no live run behind it', () => {
    const { get } = makeGet({ heteroType: 'amp' });

    noteServerIdleMarker(get, 'tpc-1');

    expect(findUntrackedHeteroMarker(get, context)).toBeUndefined();
  });
});

describe('reattachUntrackedHeteroRun', () => {
  it('reconnects this tab to the untracked run', () => {
    const { get, reconnectToGatewayOperation } = makeGet({ heteroType: 'claude-code' });

    reattachUntrackedHeteroRun(get, context);

    expect(reconnectToGatewayOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt-1',
        assistantMessageId: 'msg-1',
        heteroType: 'claude-code',
        operationId: 'op-claude-code',
        topicId: 'tpc-1',
      }),
    );
  });

  it('does nothing for an ordinary server run', () => {
    const { get, reconnectToGatewayOperation } = makeGet({ heteroType: null });

    reattachUntrackedHeteroRun(get, context);

    expect(reconnectToGatewayOperation).not.toHaveBeenCalled();
  });
});
