import { nanoid } from 'nanoid';

import { CURRENT_VERSION, isDesktop } from '@/const/version';
import { isProductUsageEventEnabled } from '@/libs/analytics/productUsageEvent';
import { bootTiming } from '@/libs/bootTiming';
import { getServerConfigStoreState } from '@/store/serverConfig';
import { getUserStoreState } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { buildBootMetricsPayload } from './buildPayload';

const SEEN_KEY = 'lobe:boot:seen';

let sent = false;

const readCold = (): boolean => {
  try {
    const cold = !localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, '1');
    return cold;
  } catch {
    return false;
  }
};

const getPlatform = (): 'desktop' | 'mobile' | 'web' => {
  if (isDesktop) return 'desktop';
  try {
    if (typeof __MOBILE__ !== 'undefined' && __MOBILE__) return 'mobile';
  } catch {
    void 0;
  }
  return 'web';
};

type RequestIdleCallback = (callback: () => void, options?: { timeout?: number }) => number;

const scheduleAfterFirstPaint = (task: () => void): void => {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  const runWhenIdle = () => {
    const ric = (window as typeof window & { requestIdleCallback?: RequestIdleCallback })
      .requestIdleCallback;

    if (typeof ric === 'function') {
      ric(task, { timeout: 1500 });
      return;
    }

    window.setTimeout(task, 0);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(runWhenIdle);
    return;
  }

  runWhenIdle();
};

const sendPayload = (ingestUrl: string): void => {
  if (sent) return;

  try {
    const snapshot = bootTiming.snapshot();
    const userState = getUserStoreState();

    const htmlMarkMs =
      typeof (window as Window & { __LOBE_BOOT_T_HTML__?: number }).__LOBE_BOOT_T_HTML__ ===
      'number'
        ? (window as Window & { __LOBE_BOOT_T_HTML__?: number }).__LOBE_BOOT_T_HTML__
        : undefined;

    const navEntry = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const navResponseStartMs = navEntry?.responseStart;

    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
    const fcpMs = fcpEntry?.startTime;

    const isLogin = Boolean(authSelectors.isLogin(userState));
    const userId = userState.user?.id;

    const payload = buildBootMetricsPayload({
      dimensions: {
        anonId: nanoid(),
        appVersion: CURRENT_VERSION,
        cold: readCold(),
        isLogin,
        platform: getPlatform(),
        userId,
      },
      fcpMs,
      htmlMarkMs,
      navResponseStartMs,
      snapshot,
    });

    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ingestUrl, new Blob([JSON.stringify(payload)], { type: 'text/plain' }));
      sent = true;
    }
  } catch {
    void 0;
  }
};

export const startBootMetricsFinalize = (): void => {
  try {
    const ingestUrl = process.env.NEXT_PUBLIC_BOOTSTRAP_METRICS_INGEST_URL;
    if (!ingestUrl) return;

    if (!isProductUsageEventEnabled()) return;

    try {
      const state = getServerConfigStoreState();
      const sampleRate =
        (
          state?.serverConfig as unknown as {
            bootstrapMetricsSampleRate?: number;
          }
        )?.bootstrapMetricsSampleRate ?? 1;
      if (Math.random() >= sampleRate) return;
    } catch {
      void 0;
    }

    scheduleAfterFirstPaint(() => sendPayload(ingestUrl));

    const pagehideHandler = () => {
      if (!sent) sendPayload(ingestUrl);
      window.removeEventListener('pagehide', pagehideHandler);
    };

    window.addEventListener('pagehide', pagehideHandler, { once: true });
  } catch {
    void 0;
  }
};
