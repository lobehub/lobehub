import type { DesktopBootProfilePayload } from '@lobechat/electron-client-ipc';
import { ipcRenderer } from 'electron';

const PROFILE_FLAG = 'LOBE_DESKTOP_BOOT_PROFILE';

const afterVisibleFrame = (callback: () => void) => {
  if (typeof window.requestAnimationFrame !== 'function') {
    window.setTimeout(callback, 0);
    return;
  }

  window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
};

/**
 * Test-only packaged-startup probe. It runs in preload so observation begins
 * before the route bundle evaluates and does not alter the production path
 * unless the explicit profiling environment flag is present.
 */
export const setupBootProfiler = () => {
  if (process.env[PROFILE_FLAG] !== '1') return;

  let reported = false;
  const report = (loadingScreenRemovedMs: number) => {
    if (reported) return;
    reported = true;

    afterVisibleFrame(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      const payload: DesktopBootProfilePayload = {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
        firstVisibleFrameMs: performance.now(),
        loadingScreenRemovedMs,
        navigationStartedAt: performance.timeOrigin,
      };
      ipcRenderer.send('desktop:boot-profile-ready', payload);
    });
  };

  window.addEventListener(
    'DOMContentLoaded',
    () => {
      const loadingScreen = document.getElementById('loading-screen');
      if (!loadingScreen) {
        report(performance.now());
        return;
      }

      const observer = new MutationObserver(() => {
        if (document.getElementById('loading-screen')) return;
        observer.disconnect();
        report(performance.now());
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    },
    { once: true },
  );
};
