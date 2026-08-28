import { getSingletonAnalyticsOptional } from '@lobehub/analytics';

export const ONBOARDING_METRICS_EVENTS = {
  COMPLETED: 'onboarding_completed',
  MARKETPLACE_PICKED: 'onboarding_marketplace_picked',
  MARKETPLACE_SHOWN: 'onboarding_marketplace_shown',
  PROFILE_CONFIRMED: 'onboarding_profile_confirmed',
  PROFILE_VIEWED: 'onboarding_profile_viewed',
  STARTED: 'onboarding_started',
  STEP_COMPLETED: 'onboarding_step_completed',
  STEP_VIEWED: 'onboarding_step_viewed',
  UNDERSTANDING_COMPLETED: 'onboarding_understanding_completed',
  UNDERSTANDING_PROGRESS: 'onboarding_understanding_progress',
  UNDERSTANDING_STARTED: 'onboarding_understanding_started',
} as const;

export const ONBOARDING_METRICS_SPM = {
  COMPLETED: 'onboarding.completed',
  MARKETPLACE_PICKED: 'onboarding.marketplace.picked',
  MARKETPLACE_SHOWN: 'onboarding.marketplace.shown',
  PROFILE_CONFIRMED: 'onboarding.profile.confirmed',
  PROFILE_VIEWED: 'onboarding.profile.viewed',
  STARTED: 'onboarding.started',
  STEP_COMPLETED: 'onboarding.step.completed',
  STEP_VIEWED: 'onboarding.step.viewed',
  UNDERSTANDING_COMPLETED: 'onboarding.understanding.completed',
  UNDERSTANDING_PROGRESS: 'onboarding.understanding.progress',
  UNDERSTANDING_STARTED: 'onboarding.understanding.started',
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

export type OnboardingFlow = 'agent' | 'classic' | 'common' | 'web';

export type OnboardingStep =
  | 'agentpicker'
  | 'chief_agent'
  | 'connect_apps'
  | 'conversation'
  | 'fullname'
  | 'interests'
  | 'learn_your_world'
  | 'messenger'
  | 'profile'
  | 'prosettings'
  | 'response_language'
  | 'starter_tasks'
  | 'telemetry'
  | 'welcome';

export interface OnboardingStepPayload extends Record<string, unknown> {
  flow: OnboardingFlow;
  onboarding_session_id?: string;
  onboarding_version?: number;
  skipped?: boolean;
  step: OnboardingStep;
  stepIndex?: number;
}

export interface OnboardingStartedPayload extends Record<string, unknown> {
  flow: Exclude<OnboardingFlow, 'common'>;
  onboarding_session_id: string;
  onboarding_version: number;
}

export interface OnboardingCompletedPayload extends Record<string, unknown> {
  flow: Exclude<OnboardingFlow, 'common'>;
  onboarding_session_id?: string;
  onboarding_version?: number;
  skipped?: boolean;
  targetUrl?: string;
}

export type OnboardingUnderstandingProgressPhase =
  | 'collecting-sources'
  | 'generating-understanding'
  | 'generating-detailed-persona'
  | 'recommending-tasks'
  | 'completed'
  | 'partial'
  | 'failed';

export type OnboardingUnderstandingStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export type OnboardingUnderstandingTerminalStatus = 'completed' | 'partial' | 'failed';

export interface OnboardingUnderstandingStartedPayload extends Record<string, unknown> {
  flow: Exclude<OnboardingFlow, 'common'>;
  onboarding_session_id: string;
  onboarding_version: number;
  understanding_session_id: string;
}

export interface OnboardingUnderstandingProgressPayload extends Record<string, unknown> {
  collect_sources_status: OnboardingUnderstandingStepStatus;
  detailed_persona_status: OnboardingUnderstandingStepStatus;
  flow: Exclude<OnboardingFlow, 'common'>;
  onboarding_session_id: string;
  onboarding_version: number;
  phase: OnboardingUnderstandingProgressPhase;
  task_recommendations_status: OnboardingUnderstandingStepStatus;
  understanding_session_id: string;
  understanding_status: OnboardingUnderstandingStepStatus;
}

export interface OnboardingUnderstandingCompletedPayload extends Record<string, unknown> {
  duration_ms?: number;
  flow: Exclude<OnboardingFlow, 'common'>;
  onboarding_session_id: string;
  onboarding_version: number;
  profile_available?: boolean;
  source_count?: number;
  source_failed_count?: number;
  source_succeeded_count?: number;
  status: OnboardingUnderstandingTerminalStatus;
  understanding_session_id: string;
}

export interface OnboardingProfilePayload extends Record<string, unknown> {
  flow: Exclude<OnboardingFlow, 'common'>;
  onboarding_session_id: string;
  onboarding_version: number;
  understanding_session_id: string;
}

export const trackOnboardingStepViewed = (payload: OnboardingStepPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.STEP_VIEWED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.STEP_VIEWED,
  });
};

export const trackOnboardingStarted = (payload: OnboardingStartedPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.STARTED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.STARTED,
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

export const trackOnboardingUnderstandingStarted = (
  payload: OnboardingUnderstandingStartedPayload,
): void => {
  emit(ONBOARDING_METRICS_EVENTS.UNDERSTANDING_STARTED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.UNDERSTANDING_STARTED,
  });
};

export const trackOnboardingUnderstandingProgress = (
  payload: OnboardingUnderstandingProgressPayload,
): void => {
  emit(ONBOARDING_METRICS_EVENTS.UNDERSTANDING_PROGRESS, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.UNDERSTANDING_PROGRESS,
  });
};

export const trackOnboardingUnderstandingCompleted = (
  payload: OnboardingUnderstandingCompletedPayload,
): void => {
  emit(ONBOARDING_METRICS_EVENTS.UNDERSTANDING_COMPLETED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.UNDERSTANDING_COMPLETED,
  });
};

export const trackOnboardingProfileViewed = (payload: OnboardingProfilePayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.PROFILE_VIEWED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.PROFILE_VIEWED,
  });
};

export const trackOnboardingProfileConfirmed = (payload: OnboardingProfilePayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.PROFILE_CONFIRMED, {
    ...payload,
    spm: ONBOARDING_METRICS_SPM.PROFILE_CONFIRMED,
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
