import { describe, expect, it } from 'vitest';

import type { FooterPromotionContext } from './promotionPipeline';
import { resolveFooterPromotionState } from './promotionPipeline';

const createContext = (overrides: Partial<FooterPromotionContext> = {}) => ({
  agentOnboardingFinished: false,
  agentOnboardingStarted: false,
  classicOnboardingFinished: true,
  enableAgentOnboarding: true,
  isAgentOnboardingPromoRead: false,
  isDesktop: false,
  isMobile: false,
  isProductHuntNotificationRead: false,
  isWithinProductHuntWindow: true,
  serverConfigInit: true,
  ...overrides,
});

describe('resolveFooterPromotionState', () => {
  it('prioritizes the agent onboarding promotion over product hunt', () => {
    expect(resolveFooterPromotionState(createContext())).toEqual({
      isAgentOnboardingPromoAvailable: true,
      shouldAutoShowAgentOnboardingPromo: true,
      shouldAutoShowProductHuntCard: false,
      shouldShowProductHuntMenuEntry: false,
    });
  });

  it('falls back to product hunt when agent onboarding promotion is unavailable', () => {
    expect(
      resolveFooterPromotionState(createContext({ classicOnboardingFinished: false })),
    ).toEqual({
      isAgentOnboardingPromoAvailable: false,
      shouldAutoShowAgentOnboardingPromo: false,
      shouldAutoShowProductHuntCard: true,
      shouldShowProductHuntMenuEntry: true,
    });
  });

  it('keeps the product hunt menu entry while suppressing auto-open after read', () => {
    expect(
      resolveFooterPromotionState(
        createContext({
          classicOnboardingFinished: false,
          isProductHuntNotificationRead: true,
        }),
      ),
    ).toEqual({
      isAgentOnboardingPromoAvailable: false,
      shouldAutoShowAgentOnboardingPromo: false,
      shouldAutoShowProductHuntCard: false,
      shouldShowProductHuntMenuEntry: true,
    });
  });

  it('returns an empty state when no promotion is eligible', () => {
    expect(
      resolveFooterPromotionState(
        createContext({
          classicOnboardingFinished: false,
          isWithinProductHuntWindow: false,
        }),
      ),
    ).toEqual({
      isAgentOnboardingPromoAvailable: false,
      shouldAutoShowAgentOnboardingPromo: false,
      shouldAutoShowProductHuntCard: false,
      shouldShowProductHuntMenuEntry: false,
    });
  });
});
