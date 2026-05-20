export const ONBOARDING_METRICS_EVENTS = {
  MARKETPLACE_PICKED: 'onboarding_marketplace_picked',
  MARKETPLACE_SHOWN: 'onboarding_marketplace_shown',
} as const;

export const ONBOARDING_METRICS_SPM = {
  MARKETPLACE_PICKED: 'onboarding.marketplace.picked',
  MARKETPLACE_SHOWN: 'onboarding.marketplace.shown',
} as const;

interface AnalyticsLike {
  track: (event: { name: string; properties?: Record<string, unknown> }) => unknown;
}

let analyticsClient: AnalyticsLike | null = null;

export const setOnboardingAnalyticsClient = (client: AnalyticsLike | null): void => {
  analyticsClient = client;
};

const emit = (name: string, properties: Record<string, unknown>): void => {
  if (!analyticsClient) return;
  try {
    analyticsClient.track({ name, properties });
  } catch (error) {
    console.error('[OnboardingMetrics] track failed', error);
  }
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
