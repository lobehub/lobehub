import { afterEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';
import { topicSelectors } from '@/store/chat/selectors';

import {
  findUntrackedHeteroMarker,
  reattachUntrackedHeteroRun,
  refreshUntrackedHeteroMarker,
  releaseUntrackedMarker,
  resetReleasedMarkers,
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
  resetReleasedMarkers();
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

  it('stops finding a marker once it was released', () => {
    const { get } = makeGet({ heteroType: 'amp' });

    releaseUntrackedMarker('op-amp', 'idle');

    expect(findUntrackedHeteroMarker(get, context)).toBeUndefined();
  });

  it('keeps finding a newer marker when an older one was released', () => {
    const { get } = makeGet({ heteroType: 'codex' });

    releaseUntrackedMarker('op-older', 'idle');

    expect(findUntrackedHeteroMarker(get, context)?.operationId).toBe('op-codex');
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

describe('refreshUntrackedHeteroMarker', () => {
  const topicWith = (operationId: string | null) =>
    ({
      id: 'tpc-1',
      metadata: {
        runningOperation: operationId ? { operationId, heteroType: 'claude-code' } : null,
      },
    }) as any;

  it('takes the server marker when it changed', async () => {
    let local = topicWith('op-old');
    vi.spyOn(topicSelectors, 'getTopicById').mockReturnValue(() => local);
    vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue(topicWith(null));
    const dispatch = vi.fn((action: any) => {
      local = { ...local, ...action.value };
    });

    await refreshUntrackedHeteroMarker(
      () => ({ internal_dispatchTopic: dispatch }) as any,
      'tpc-1',
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ value: { metadata: { runningOperation: null } } }),
    );
  });

  it('keeps a newer local marker that landed while the read was in flight', async () => {
    let local = topicWith('op-old');
    vi.spyOn(topicSelectors, 'getTopicById').mockReturnValue(() => local);
    vi.spyOn(topicService, 'getTopicDetail').mockImplementation(async () => {
      local = topicWith('op-new');
      return topicWith(null);
    });
    const dispatch = vi.fn();

    await refreshUntrackedHeteroMarker(
      () => ({ internal_dispatchTopic: dispatch }) as any,
      'tpc-1',
    );

    expect(dispatch).not.toHaveBeenCalled();
  });
});
