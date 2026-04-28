export const ONBOARDING_METRICS_EVENTS = {
  MARKETPLACE_PICKED: 'onboarding_marketplace_picked',
  MARKETPLACE_SHOWN: 'onboarding_marketplace_shown',
} as const;

interface AnalyticsLike {
  track: (event: { name: string; properties?: Record<string, unknown> }) => unknown;
}

let analyticsClient: AnalyticsLike | null = null;

// TODO(LOBE-7801): wire this setter from the app bootstrap provider.
// The picker runtime's `onShown` / `onPicked` hooks already call the `track*`
// functions below, but without a configured analytics client they no-op.
// Options for follow-up:
//   - Inject via a top-level React provider that reads useAnalytics() and
//     calls setOnboardingAnalyticsClient at mount.
//   - Or, move to a per-call options pattern matching onboardingFeedback.ts.
// Until wired, telemetry events are silently dropped.
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
  emit(ONBOARDING_METRICS_EVENTS.MARKETPLACE_SHOWN, { ...payload });
};

export interface MarketplacePickedPayload {
  categoryHints: string[];
  requestId: string;
  selectedTemplateIds: string[];
}

export const trackOnboardingMarketplacePicked = (payload: MarketplacePickedPayload): void => {
  emit(ONBOARDING_METRICS_EVENTS.MARKETPLACE_PICKED, { ...payload });
};
