import type {
  AnalyticsEvent,
  AnalyticsManager,
  GoogleAnalyticsProviderConfig,
  PostHogProviderAnalyticsConfig,
  XAdsProviderAnalyticsConfig,
} from '@lobehub/analytics';

import { BUSINESS_LINE } from '@/const/analytics';
import { isDesktop } from '@/const/version';

export interface AnalyticsClientConfig {
  ga4: GoogleAnalyticsProviderConfig;
  posthog: PostHogProviderAnalyticsConfig;
  xAds: XAdsProviderAnalyticsConfig;
}

type Pending =
  | { event: AnalyticsEvent; type: 'track' }
  | { traits: Record<string, unknown>; type: 'identify'; userId: string };

let manager: AnalyticsManager | null = null;
let loading: Promise<AnalyticsManager | null> | null = null;
const QUEUE_LIMIT = 100;
const queue: Pending[] = [];

const enqueue = (item: Pending) => {
  if (queue.length >= QUEUE_LIMIT) queue.shift();
  queue.push(item);
};

const apply = (item: Pending) => {
  if (!manager) return;
  if (item.type === 'track') void manager.track(item.event);
  else manager.identify(item.userId, item.traits);
};

export const loadAnalytics = (config: AnalyticsClientConfig) => {
  if (loading) return loading;

  loading = import('@lobehub/analytics')
    .then(async ({ createSingletonAnalytics }) => {
      const instance = createSingletonAnalytics({
        business: BUSINESS_LINE,
        debug: false,
        providers: config,
      });
      await instance.initialize();

      const platform = isDesktop ? 'desktop' : 'web';
      instance.setGlobalContext({ platform });
      instance.getProvider('posthog')?.getNativeInstance()?.register({ platform });

      manager = instance;
      for (const item of queue.splice(0)) apply(item);
      return instance;
    })
    .catch((error) => {
      console.error('[Analytics] initialization failed:', error);
      queue.length = 0;
      return null;
    });

  return loading;
};

export const getAnalyticsManager = () => manager;

export const analyticsClient = {
  identify: (userId: string, traits: Record<string, unknown>) => {
    if (manager) void manager.identify(userId, traits);
    else enqueue({ traits, type: 'identify', userId });
  },
  track: async (event: AnalyticsEvent) => {
    if (manager) return manager.track(event);
    enqueue({ event, type: 'track' });
  },
};

export type AnalyticsClient = typeof analyticsClient;

export const useAnalytics = () => ({ analytics: analyticsClient });

export const __testing = {
  reset: () => {
    manager = null;
    loading = null;
    queue.length = 0;
  },
};
