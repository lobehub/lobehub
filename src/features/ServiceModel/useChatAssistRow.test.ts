import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { useChatAssistRow } from './useChatAssistRow';

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  useUserStore.setState(initialUserStoreState, true);
});

describe('useChatAssistRow', () => {
  it('keeps each row’s save result when both rows save at once', async () => {
    let failInputCompletion!: (error: Error) => void;
    let finishFollowUp!: () => void;
    const updatePersonalSystemAgent = vi.fn((key: string) =>
      key === 'inputCompletion'
        ? new Promise<void>((_, reject) => (failInputCompletion = reject))
        : new Promise<void>((resolve) => (finishFollowUp = resolve)),
    );
    useUserStore.setState({ updatePersonalSystemAgent } as any);

    const followUp = renderHook(() => useChatAssistRow('followUpAction'));
    const inputCompletion = renderHook(() => useChatAssistRow('inputCompletion'));

    let followUpSave!: Promise<void>;
    let inputCompletionSave!: Promise<void>;
    act(() => {
      followUpSave = followUp.result.current.update({ enabled: true });
      inputCompletionSave = inputCompletion.result.current.update({ enabled: true });
    });

    // The later row fails first, then the earlier row succeeds
    await act(async () => {
      failInputCompletion(new Error('network error'));
      await inputCompletionSave;
    });
    await act(async () => {
      finishFollowUp();
      await followUpSave;
    });

    // A shared save state would end on 'saved' and hide the failed row's retry
    expect(followUp.result.current.saveState.status).toBe('saved');
    expect(inputCompletion.result.current.saveState.status).toBe('failed');
    expect(followUp.result.current.loading).toBe(false);
    expect(inputCompletion.result.current.loading).toBe(false);
  });
});
