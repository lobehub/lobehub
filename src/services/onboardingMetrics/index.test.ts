import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ONBOARDING_METRICS_EVENTS,
  ONBOARDING_METRICS_SPM,
  setOnboardingAnalyticsClient,
  trackOnboardingMarketplacePicked,
  trackOnboardingMarketplaceShown,
} from './index';

describe('onboardingMetrics', () => {
  const track = vi.fn();

  beforeEach(() => {
    track.mockReset();
    setOnboardingAnalyticsClient({ track });
  });

  it('fires onboarding_marketplace_shown with categoryHints and requestId', () => {
    trackOnboardingMarketplaceShown({
      categoryHints: ['engineering', 'design-creative'],
      requestId: 'req-a',
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.MARKETPLACE_SHOWN,
      properties: {
        categoryHints: ['engineering', 'design-creative'],
        requestId: 'req-a',
        spm: ONBOARDING_METRICS_SPM.MARKETPLACE_SHOWN,
      },
    });
  });

  it('fires onboarding_marketplace_picked with categoryHints, requestId and selectedTemplateIds', () => {
    trackOnboardingMarketplacePicked({
      categoryHints: ['engineering'],
      requestId: 'req-b',
      selectedTemplateIds: ['pair-programmer', 'code-reviewer'],
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.MARKETPLACE_PICKED,
      properties: {
        categoryHints: ['engineering'],
        requestId: 'req-b',
        selectedTemplateIds: ['pair-programmer', 'code-reviewer'],
        spm: ONBOARDING_METRICS_SPM.MARKETPLACE_PICKED,
      },
    });
  });

  it('is a no-op when no analytics client is configured', () => {
    setOnboardingAnalyticsClient(null);
    expect(() =>
      trackOnboardingMarketplaceShown({ categoryHints: ['engineering'], requestId: 'req-c' }),
    ).not.toThrow();
  });

  it('swallows analytics errors so the caller never observes them', () => {
    setOnboardingAnalyticsClient({
      track: () => {
        throw new Error('boom');
      },
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() =>
      trackOnboardingMarketplacePicked({
        categoryHints: ['engineering'],
        requestId: 'req-d',
        selectedTemplateIds: ['pair-programmer'],
      }),
    ).not.toThrow();

    error.mockRestore();
  });
});
