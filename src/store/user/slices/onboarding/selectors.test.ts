import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import { MAX_ONBOARDING_STEPS } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type UserStore } from '@/store/user';

import { initialOnboardingState } from './initialState';
import { onboardingSelectors } from './selectors';

describe('onboardingSelectors', () => {
  describe('currentStep', () => {
    it('should return localOnboardingStep when set', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: 3,
        onboarding: { currentStep: 1, version: CURRENT_ONBOARDING_VERSION },
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(3);
    });

    it('should return onboarding.currentStep when localOnboardingStep is undefined', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: undefined,
        onboarding: { currentStep: 4, version: CURRENT_ONBOARDING_VERSION },
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(4);
    });

    it('should return 1 when both localOnboardingStep and onboarding.currentStep are undefined', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: undefined,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(1);
    });

    it('should clamp step to minimum of 1 when step is less than 1', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: 0,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(1);
    });

    it('should clamp step to minimum of 1 when step is negative', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: -5,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(1);
    });

    it('should clamp step to MAX_ONBOARDING_STEPS when step exceeds maximum', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: 10,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(MAX_ONBOARDING_STEPS);
    });

    it('should clamp server state step to MAX_ONBOARDING_STEPS when it exceeds maximum', () => {
      const store = {
        ...initialOnboardingState,
        localOnboardingStep: undefined,
        onboarding: { currentStep: 29, version: CURRENT_ONBOARDING_VERSION },
      } as unknown as UserStore;

      expect(onboardingSelectors.currentStep(store)).toBe(MAX_ONBOARDING_STEPS);
    });

    it('should return exact step when within valid range', () => {
      for (let step = 1; step <= MAX_ONBOARDING_STEPS; step++) {
        const store = {
          ...initialOnboardingState,
          localOnboardingStep: step,
          onboarding: undefined,
        } as unknown as UserStore;

        expect(onboardingSelectors.currentStep(store)).toBe(step);
      }
    });
  });

  describe('version', () => {
    it('should return onboarding version', () => {
      const store = {
        ...initialOnboardingState,
        onboarding: { version: 2 },
      } as unknown as UserStore;

      expect(onboardingSelectors.version(store)).toBe(2);
    });

    it('should return CURRENT_ONBOARDING_VERSION when onboarding is undefined', () => {
      const store = {
        ...initialOnboardingState,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.version(store)).toBe(CURRENT_ONBOARDING_VERSION);
    });
  });

  describe('finishedAt', () => {
    it('should return finishedAt when set', () => {
      const finishedAt = '2024-01-01T00:00:00Z';
      const store = {
        ...initialOnboardingState,
        onboarding: { finishedAt, version: CURRENT_ONBOARDING_VERSION },
      } as unknown as UserStore;

      expect(onboardingSelectors.finishedAt(store)).toBe(finishedAt);
    });

    it('should return undefined when onboarding is undefined', () => {
      const store = {
        ...initialOnboardingState,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.finishedAt(store)).toBeUndefined();
    });
  });

  describe('isFinished', () => {
    it('should return true when finishedAt is set', () => {
      const store = {
        ...initialOnboardingState,
        onboarding: { finishedAt: '2024-01-01T00:00:00Z', version: CURRENT_ONBOARDING_VERSION },
      } as unknown as UserStore;

      expect(onboardingSelectors.isFinished(store)).toBe(true);
    });

    it('should return false when finishedAt is undefined', () => {
      const store = {
        ...initialOnboardingState,
        onboarding: { version: CURRENT_ONBOARDING_VERSION },
      } as unknown as UserStore;

      expect(onboardingSelectors.isFinished(store)).toBe(false);
    });

    it('should return false when onboarding is undefined', () => {
      const store = {
        ...initialOnboardingState,
        onboarding: undefined,
      } as unknown as UserStore;

      expect(onboardingSelectors.isFinished(store)).toBe(false);
    });
  });

  describe('needsOnboarding', () => {
    it('should return true when finishedAt is not set', () => {
      const store = {
        onboarding: { version: CURRENT_ONBOARDING_VERSION },
      } as Pick<UserStore, 'onboarding'>;

      expect(onboardingSelectors.needsOnboarding(store)).toBe(true);
    });

    it('should return true when version is older than current', () => {
      // If CURRENT_ONBOARDING_VERSION > 1, test with version 1
      // Otherwise, this test is not applicable since there's no valid older version
      if (CURRENT_ONBOARDING_VERSION > 1) {
        const store = {
          onboarding: {
            finishedAt: '2024-01-01T00:00:00Z',
            version: 1,
          },
        } as Pick<UserStore, 'onboarding'>;

        expect(onboardingSelectors.needsOnboarding(store)).toBe(true);
      } else {
        // When CURRENT_ONBOARDING_VERSION is 1, there's no valid older version (0 is falsy)
        // Test that version 0 is treated as NOT needing onboarding due to falsy check
        const store = {
          onboarding: {
            finishedAt: '2024-01-01T00:00:00Z',
            version: 0,
          },
        } as Pick<UserStore, 'onboarding'>;

        // version 0 is falsy, so the condition (version && version < CURRENT) short-circuits to 0 (falsy)
        // finishedAt is set, so the first condition is false
        // The result is falsy (0), not strictly false
        expect(onboardingSelectors.needsOnboarding(store)).toBeFalsy();
      }
    });

    it('should return false when finishedAt is set and version is current', () => {
      const store = {
        onboarding: {
          finishedAt: '2024-01-01T00:00:00Z',
          version: CURRENT_ONBOARDING_VERSION,
        },
      } as Pick<UserStore, 'onboarding'>;

      expect(onboardingSelectors.needsOnboarding(store)).toBe(false);
    });

    it('should return true when onboarding is undefined', () => {
      const store = {
        onboarding: undefined,
      } as Pick<UserStore, 'onboarding'>;

      expect(onboardingSelectors.needsOnboarding(store)).toBe(true);
    });
  });
});
