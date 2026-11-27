import { describe, expect, it, vi } from 'vitest';

import { watchSteerRestart } from '@/store/chat/slices/agentRun/actions/lifecycle/steerRestart';
import type { ChatStore } from '@/store/chat/store';

import { applyStreamStartMetadata, streamStartOperationMetadata } from './streamStartSeed';

vi.mock('@/store/chat/slices/agentRun/actions/lifecycle/steerRestart', () => ({
  watchSteerRestart: vi.fn(async () => {}),
}));

const context = { agentId: 'agent-1', topicId: 'topic-1' };

describe('streamStartOperationMetadata', () => {
  it('marks a producer that steers live', () => {
    expect(streamStartOperationMetadata({ liveSteer: true })).toEqual({
      liveSteer: true,
      visibleLoadingDone: false,
    });
  });

  it('marks a producer whose session takes no input as unable to steer', () => {
    expect(streamStartOperationMetadata({ liveSteer: false })).toEqual({
      steerUnsupported: true,
      visibleLoadingDone: false,
    });
  });

  it('claims nothing about a producer that did not say', () => {
    expect(streamStartOperationMetadata({})).toEqual({ visibleLoadingDone: false });
    expect(streamStartOperationMetadata(undefined)).toEqual({ visibleLoadingDone: false });
  });
});

describe('applyStreamStartMetadata', () => {
  const storeWith = () => {
    const store = { updateOperationMetadata: vi.fn() } as unknown as ChatStore;
    return { get: () => store, store };
  };

  it('watches a run found unable to steer for a restart', async () => {
    const { get, store } = storeWith();

    applyStreamStartMetadata(get, { context, operationId: 'op-1' }, { liveSteer: false });

    expect(store.updateOperationMetadata).toHaveBeenCalledWith('op-1', {
      steerUnsupported: true,
      visibleLoadingDone: false,
    });
    await vi.waitFor(() =>
      expect(watchSteerRestart).toHaveBeenCalledWith({ context, get, operationId: 'op-1' }),
    );
  });

  it('watches nothing for a run that steers or did not say', async () => {
    vi.mocked(watchSteerRestart).mockClear();
    const { get } = storeWith();

    applyStreamStartMetadata(get, { context, operationId: 'op-1' }, { liveSteer: true });
    applyStreamStartMetadata(get, { context, operationId: 'op-1' }, {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(watchSteerRestart).not.toHaveBeenCalled();
  });
});
