import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ONBOARDING_METRICS_EVENTS,
  ONBOARDING_METRICS_SPM,
  setOnboardingAnalyticsClient,
  trackOnboardingCompleted,
  trackOnboardingMarketplacePicked,
  trackOnboardingMarketplaceShown,
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
} from './index';

const analyticsMocks = vi.hoisted(() => ({
  getSingletonAnalyticsOptional: vi.fn(),
}));

vi.mock('@lobehub/analytics', () => ({
  getSingletonAnalyticsOptional: analyticsMocks.getSingletonAnalyticsOptional,
}));

describe('onboardingMetrics', () => {
  const track = vi.fn();

  beforeEach(() => {
    track.mockReset();
    analyticsMocks.getSingletonAnalyticsOptional.mockReset();
    analyticsMocks.getSingletonAnalyticsOptional.mockReturnValue(null);
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

  it('fires onboarding_step_viewed with flow, step and stepIndex', () => {
    trackOnboardingStepViewed({
      flow: 'common',
      step: 'telemetry',
      stepIndex: 1,
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.STEP_VIEWED,
      properties: {
        flow: 'common',
        spm: ONBOARDING_METRICS_SPM.STEP_VIEWED,
        step: 'telemetry',
        stepIndex: 1,
      },
    });
  });

  it('fires onboarding_step_completed with extra step context', () => {
    trackOnboardingStepCompleted({
      action: 'auto_skip',
      flow: 'classic',
      skipped: true,
      step: 'prosettings',
      stepIndex: 3,
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.STEP_COMPLETED,
      properties: {
        action: 'auto_skip',
        flow: 'classic',
        skipped: true,
        spm: ONBOARDING_METRICS_SPM.STEP_COMPLETED,
        step: 'prosettings',
        stepIndex: 3,
      },
    });
  });

  it('fires onboarding_completed with the branch flow and targetUrl', () => {
    trackOnboardingCompleted({
      flow: 'classic',
      targetUrl: '/',
    });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.COMPLETED,
      properties: {
        flow: 'classic',
        spm: ONBOARDING_METRICS_SPM.COMPLETED,
        targetUrl: '/',
      },
    });
  });

  it('falls back to the global analytics singleton when no explicit client is configured', () => {
    const singletonTrack = vi.fn();
    setOnboardingAnalyticsClient(null);
    analyticsMocks.getSingletonAnalyticsOptional.mockReturnValue({ track: singletonTrack });

    trackOnboardingStepViewed({
      flow: 'classic',
      step: 'fullname',
      stepIndex: 1,
    });

    expect(singletonTrack).toHaveBeenCalledTimes(1);
    expect(singletonTrack).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.STEP_VIEWED,
      properties: {
        flow: 'classic',
        spm: ONBOARDING_METRICS_SPM.STEP_VIEWED,
        step: 'fullname',
        stepIndex: 1,
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
