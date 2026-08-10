import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ONBOARDING_METRICS_EVENTS,
  ONBOARDING_METRICS_SPM,
  setOnboardingAnalyticsClient,
  trackOnboardingCompleted,
  trackOnboardingMarketplacePicked,
  trackOnboardingMarketplaceShown,
  trackOnboardingProfileConfirmed,
  trackOnboardingProfileViewed,
  trackOnboardingStarted,
  trackOnboardingStepCompleted,
  trackOnboardingStepViewed,
  trackOnboardingUnderstandingCompleted,
  trackOnboardingUnderstandingProgress,
  trackOnboardingUnderstandingStarted,
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

  it('fires onboarding_started with the versioned session context', () => {
    trackOnboardingStarted({
      flow: 'web',
      onboarding_session_id: 'session-1',
      onboarding_version: 2,
    });

    expect(track).toHaveBeenCalledWith({
      name: ONBOARDING_METRICS_EVENTS.STARTED,
      properties: {
        flow: 'web',
        onboarding_session_id: 'session-1',
        onboarding_version: 2,
        spm: ONBOARDING_METRICS_SPM.STARTED,
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

  it('fires understanding lifecycle and profile interaction events without profile content', () => {
    const context = {
      flow: 'web' as const,
      onboarding_session_id: 'onboarding-session-1',
      onboarding_version: 2,
      understanding_session_id: 'understanding-session-1',
    };

    trackOnboardingUnderstandingStarted(context);
    trackOnboardingUnderstandingProgress({
      ...context,
      collect_sources_status: 'completed',
      detailed_persona_status: 'running',
      phase: 'generating-detailed-persona',
      task_recommendations_status: 'pending',
      understanding_status: 'completed',
    });
    trackOnboardingUnderstandingCompleted({
      ...context,
      duration_ms: 2400,
      profile_available: true,
      source_count: 2,
      source_failed_count: 0,
      source_succeeded_count: 2,
      status: 'completed',
    });
    trackOnboardingProfileViewed(context);
    trackOnboardingProfileConfirmed(context);

    expect(track).toHaveBeenNthCalledWith(1, {
      name: ONBOARDING_METRICS_EVENTS.UNDERSTANDING_STARTED,
      properties: { ...context, spm: ONBOARDING_METRICS_SPM.UNDERSTANDING_STARTED },
    });
    expect(track).toHaveBeenNthCalledWith(2, {
      name: ONBOARDING_METRICS_EVENTS.UNDERSTANDING_PROGRESS,
      properties: {
        ...context,
        collect_sources_status: 'completed',
        detailed_persona_status: 'running',
        phase: 'generating-detailed-persona',
        spm: ONBOARDING_METRICS_SPM.UNDERSTANDING_PROGRESS,
        task_recommendations_status: 'pending',
        understanding_status: 'completed',
      },
    });
    expect(track).toHaveBeenNthCalledWith(3, {
      name: ONBOARDING_METRICS_EVENTS.UNDERSTANDING_COMPLETED,
      properties: {
        ...context,
        duration_ms: 2400,
        profile_available: true,
        source_count: 2,
        source_failed_count: 0,
        source_succeeded_count: 2,
        spm: ONBOARDING_METRICS_SPM.UNDERSTANDING_COMPLETED,
        status: 'completed',
      },
    });
    expect(track).toHaveBeenNthCalledWith(4, {
      name: ONBOARDING_METRICS_EVENTS.PROFILE_VIEWED,
      properties: { ...context, spm: ONBOARDING_METRICS_SPM.PROFILE_VIEWED },
    });
    expect(track).toHaveBeenNthCalledWith(5, {
      name: ONBOARDING_METRICS_EVENTS.PROFILE_CONFIRMED,
      properties: { ...context, spm: ONBOARDING_METRICS_SPM.PROFILE_CONFIRMED },
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
