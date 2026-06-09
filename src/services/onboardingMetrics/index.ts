import { getSingletonAnalyticsOptional } from '@lobehub/analytics';

export const ONBOARDING_METRICS_EVENTS = {
  COMPLETED: 'onboarding_completed',
  MARKETPLACE_PICKED: 'onboarding_marketplace_picked',
  MARKETPLACE_SHOWN: 'onboarding_marketplace_shown',
  STEP_COMPLETED: 'onboarding_step_completed',
  STEP_VIEWED: 'onboarding_step_viewed',
} as const;

export const ONBOARDING_METRICS_SPM = {
  COMPLETED: 'onboarding.completed',
  MARKETPLACE_PICKED: 'onboarding.marketplace.picked',
  MARKETPLACE_SHOWN: 'onboarding.marketplace.shown',
  STEP_COMPLETED: 'onboarding.step.completed',
  STEP_VIEWED: 'onboarding.step.viewed',
} as const;

interface AnalyticsLike {
  track: (event: { name: string; properties?: Record<string, unknown> }) => unknown;
}

let analyticsClient: AnalyticsLike | null = null;

export const setOnboardingAnalyticsClient = (client: AnalyticsLike | null): void => {
  analyticsClient = client;
};

const emit = (name: string, properties: Record<string, unknown>): void => {
  const client = analyticsClient ?? getSingletonAnalyticsOptional();
  if (!client) return;

  try {
    client.track({ name, properties });
  } catch (error) {
    console.error('[OnboardingMetrics] track failed', error);
  }
};

export type OnboardingFlow = 'agent' | 'classic' | 'common';

export type OnboardingStep =
  | 'agentpicker'
  | 'conversation'
  | 'fullname'
  | 'interests'
  | 'prosettings'
  | 'response_language'
  | 'telemetry';

export interface OnboardingStepPayload extends Record<string, unknown> {
  flow: OnboardingFlow;
  skipped?: boolean;
  step: OnboardingStep;
  stepIndex?: number;
}

export interface OnboardingCompletedPayload extends Record<string, unknown> {
  flow: Exclude<OnboardingFlow, 'common'>;
  targetUrl?: string;
}

export const trackOnboardingStepViewed = (payload: OnboardingStepPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.STEP_VIEWED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.STEP_VIEWED,
  });
};

export const trackOnboardingStepCompleted = (payload: OnboardingStepPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.STEP_COMPLETED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.STEP_COMPLETED,
  });
};

export const trackOnboardingCompleted = (payload: OnboardingCompletedPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.COMPLETED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.COMPLETED,
  });
};

export interface MarketplaceShownPayload {
  categoryHints: string[];
  requestId: string;
}

export const trackOnboardingMarketplaceShown = (payload: MarketplaceShownPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.MARKETPLACE_SHOWN, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.MARKETPLACE_SHOWN,
  });
};

export interface MarketplacePickedPayload {
  categoryHints: string[];
  requestId: string;
  selectedTemplateIds: string[];
}

export const trackOnboardingMarketplacePicked = (payload: MarketplacePickedPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.MARKETPLACE_PICKED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.MARKETPLACE_PICKED,
  });
};
