import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { userService } from '@/services/user';
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

  describe('goToNextStep', () => {
    it('should increment step and set localOnboardingStep', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          onboarding: { currentStep: 1, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToNextStep();
      });

      expect(result.current.localOnboardingStep).toBe(2);
    });

    it('should not increment step when already at MAX_ONBOARDING_STEPS', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          localOnboardingStep: MAX_ONBOARDING_STEPS,
          onboarding: { currentStep: MAX_ONBOARDING_STEPS, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToNextStep();
      });

      // localOnboardingStep should remain at MAX_ONBOARDING_STEPS
      expect(result.current.localOnboardingStep).toBe(MAX_ONBOARDING_STEPS);
    });

    it('should queue step update when incrementing', () => {
      const { result } = renderHook(() => useUserStore());

      const queueStepUpdateSpy = vi.spyOn(result.current, 'internal_queueStepUpdate');

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          onboarding: { currentStep: 2, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToNextStep();
      });

      expect(queueStepUpdateSpy).toHaveBeenCalledWith(3);
    });

    it('should not queue step update when at MAX_ONBOARDING_STEPS', () => {
      const { result } = renderHook(() => useUserStore());

      const queueStepUpdateSpy = vi.spyOn(result.current, 'internal_queueStepUpdate');

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          localOnboardingStep: MAX_ONBOARDING_STEPS,
          onboarding: { currentStep: MAX_ONBOARDING_STEPS, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToNextStep();
      });

      expect(queueStepUpdateSpy).not.toHaveBeenCalled();
    });
  });

  describe('goToPreviousStep', () => {
    it('should decrement step and set localOnboardingStep', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          localOnboardingStep: 3,
          onboarding: { currentStep: 3, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToPreviousStep();
      });

      expect(result.current.localOnboardingStep).toBe(2);
    });

    it('should not decrement step when already at step 1', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          localOnboardingStep: 1,
          onboarding: { currentStep: 1, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToPreviousStep();
      });

      // localOnboardingStep should remain at 1
      expect(result.current.localOnboardingStep).toBe(1);
    });

    it('should queue step update when decrementing', () => {
      const { result } = renderHook(() => useUserStore());

      const queueStepUpdateSpy = vi.spyOn(result.current, 'internal_queueStepUpdate');

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          localOnboardingStep: 3,
          onboarding: { currentStep: 3, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToPreviousStep();
      });

      expect(queueStepUpdateSpy).toHaveBeenCalledWith(2);
    });

    it('should not queue step update when at step 1', () => {
      const { result } = renderHook(() => useUserStore());

      const queueStepUpdateSpy = vi.spyOn(result.current, 'internal_queueStepUpdate');

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          localOnboardingStep: 1,
          onboarding: { currentStep: 1, version: CURRENT_ONBOARDING_VERSION },
        });
      });

      act(() => {
        result.current.goToPreviousStep();
      });

      expect(queueStepUpdateSpy).not.toHaveBeenCalled();
    });
  });

  describe('internal_queueStepUpdate', () => {
    it('should add task to empty queue and start processing', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [],
        });
      });

      const processSpy = vi.spyOn(result.current, 'internal_processStepUpdateQueue');

      act(() => {
        result.current.internal_queueStepUpdate(2);
      });

      expect(result.current.stepUpdateQueue).toContain(2);
      expect(processSpy).toHaveBeenCalled();
    });

    it('should add pending task when one task is executing', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [2],
          isProcessingStepQueue: true,
        });
      });

      act(() => {
        result.current.internal_queueStepUpdate(3);
      });

      expect(result.current.stepUpdateQueue).toEqual([2, 3]);
    });

    it('should replace pending task when queue has two tasks', () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [2, 3],
          isProcessingStepQueue: true,
        });
      });

      act(() => {
        result.current.internal_queueStepUpdate(4);
      });

      expect(result.current.stepUpdateQueue).toEqual([2, 4]);
    });
  });

  describe('internal_processStepUpdateQueue', () => {
    it('should not process when already processing', async () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [2],
          isProcessingStepQueue: true,
        });
      });

      await act(async () => {
        await result.current.internal_processStepUpdateQueue();
      });

      // userService.updateOnboarding should not be called
      expect(userService.updateOnboarding).not.toHaveBeenCalled();
    });

    it('should not process when queue is empty', async () => {
      const { result } = renderHook(() => useUserStore());

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [],
          isProcessingStepQueue: false,
        });
      });

      await act(async () => {
        await result.current.internal_processStepUpdateQueue();
      });

      expect(userService.updateOnboarding).not.toHaveBeenCalled();
    });

    it('should process queue and call userService.updateOnboarding', async () => {
      const { result } = renderHook(() => useUserStore());

      vi.mocked(userService.updateOnboarding).mockResolvedValue({} as any);

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [2],
          isProcessingStepQueue: false,
          onboarding: { version: CURRENT_ONBOARDING_VERSION },
          refreshUserState: vi.fn(),
        });
      });

      await act(async () => {
        await result.current.internal_processStepUpdateQueue();
      });

      expect(userService.updateOnboarding).toHaveBeenCalledWith({
        currentStep: 2,
        finishedAt: undefined,
        version: CURRENT_ONBOARDING_VERSION,
      });
    });

    it('should handle errors gracefully and continue processing', async () => {
      const { result } = renderHook(() => useUserStore());
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(userService.updateOnboarding).mockRejectedValueOnce(new Error('Update failed'));

      act(() => {
        useUserStore.setState({
          ...initialOnboardingState,
          stepUpdateQueue: [2],
          isProcessingStepQueue: false,
          onboarding: { version: CURRENT_ONBOARDING_VERSION },
          refreshUserState: vi.fn(),
        });
      });

      await act(async () => {
        await result.current.internal_processStepUpdateQueue();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to update onboarding step:',
        expect.any(Error),
      );
      expect(result.current.isProcessingStepQueue).toBe(false);

      consoleErrorSpy.mockRestore();
    });
  });
});
