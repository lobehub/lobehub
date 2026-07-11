import { CURRENT_ONBOARDING_VERSION, INBOX_SESSION_ID } from '@lobechat/const';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { userService } from '@/services/user';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';

import { initialOnboardingState } from './initialState';

vi.mock('zustand/traditional');

vi.mock('@/services/user', () => ({
  userService: {
    updateOnboarding: vi.fn(),
  },
}));

describe('onboarding actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useUserStore.setState({
        ...initialOnboardingState,
        onboarding: { currentStep: 1, version: CURRENT_ONBOARDING_VERSION },
        refreshUserState: vi.fn(),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('write serialization', () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };

    it('preserves finishedAt when a slow step write lands after finish (step -> finish)', async () => {
      const { result } = renderHook(() => useUserStore());

      const stepDeferred = deferred<any>();
      const finishDeferred = deferred<any>();
      vi.mocked(userService.updateOnboarding)
        .mockReturnValueOnce(stepDeferred.promise)
        .mockReturnValueOnce(finishDeferred.promise);

      let stepPromise!: Promise<void>;
      let finishPromise!: Promise<void>;
      await act(async () => {
        stepPromise = result.current.setOnboardingStep(6);
        // Let the step write's task actually reach userService before finish is issued.
        await Promise.resolve();
        finishPromise = result.current.finishOnboarding();
      });

      // Resolve the finish write first even though it was queued second -
      // the chain must still send it after the step write settles.
      finishDeferred.resolve({});
      stepDeferred.resolve({});

      await act(async () => {
        await Promise.all([stepPromise, finishPromise]);
      });

      expect(userService.updateOnboarding).toHaveBeenNthCalledWith(1, {
        currentStep: 6,
        finishedAt: undefined,
        version: CURRENT_ONBOARDING_VERSION,
      });
      expect(userService.updateOnboarding).toHaveBeenNthCalledWith(2, {
        currentStep: 6,
        finishedAt: expect.any(String),
        version: CURRENT_ONBOARDING_VERSION,
      });
    });

    it('preserves finishedAt when a step write is queued after finish (finish -> step)', async () => {
      const { result } = renderHook(() => useUserStore());

      const finishDeferred = deferred<any>();
      const stepDeferred = deferred<any>();
      vi.mocked(userService.updateOnboarding)
        .mockReturnValueOnce(finishDeferred.promise)
        .mockReturnValueOnce(stepDeferred.promise);

      let finishPromise!: Promise<void>;
      let stepPromise!: Promise<void>;
      await act(async () => {
        finishPromise = result.current.finishOnboarding();
        // Let the finish write's task actually reach userService before step is issued.
        await Promise.resolve();
        stepPromise = result.current.setOnboardingStep(6);
      });

      stepDeferred.resolve({});
      finishDeferred.resolve({});

      await act(async () => {
        await Promise.all([finishPromise, stepPromise]);
      });

      expect(userService.updateOnboarding).toHaveBeenNthCalledWith(1, {
        currentStep: expect.any(Number),
        finishedAt: expect.any(String),
        version: CURRENT_ONBOARDING_VERSION,
      });
      // The queued step write is composed after finish's optimistic update lands,
      // so it must carry the same finishedAt instead of clobbering it.
      const secondCall = vi.mocked(userService.updateOnboarding).mock.calls[1][0];
      const firstCall = vi.mocked(userService.updateOnboarding).mock.calls[0][0];
      expect(secondCall.finishedAt).toBe(firstCall.finishedAt);
      expect(secondCall.currentStep).toBe(6);
    });
  });

  describe('toggleInboxAgentDefaultPlugin', () => {
    const updateAgentConfigById = vi.fn();

    beforeEach(() => {
      updateAgentConfigById.mockClear();
      act(() => {
        useAgentStore.setState({
          agentMap: { 'inbox-agent-id': { plugins: ['plugin-1'] } as any },
          builtinAgentIdMap: { [INBOX_SESSION_ID]: 'inbox-agent-id' },
          updateAgentConfigById,
        } as any);
      });
    });

    it('flips an existing disabled object entry back to pinned, without duplicating it', async () => {
      act(() => {
        useAgentStore.setState({
          agentMap: {
            'inbox-agent-id': {
              plugins: ['plugin-1', { identifier: 'plugin-2', mode: 'disabled' }],
            } as any,
          },
        } as any);
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.toggleInboxAgentDefaultPlugin('plugin-2', true);
      });

      expect(updateAgentConfigById).toHaveBeenCalledWith('inbox-agent-id', {
        plugins: ['plugin-1', { identifier: 'plugin-2', mode: 'pinned' }],
      });
    });

    it('setting open=false reverts the entry to auto, removing it from the array', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.toggleInboxAgentDefaultPlugin('plugin-1', false);
      });

      expect(updateAgentConfigById).toHaveBeenCalledWith('inbox-agent-id', { plugins: [] });
    });
  });
});
