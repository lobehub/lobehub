import { setPostRenderReady } from '../atoms/app';
import { startConnectorInitialization } from './connectors';
import { shouldSkipRoutePreload, startRoutePreload } from './routePreload';
import { ensureBuiltinToolSurfaces } from './toolSurfaces';

type RequestIdleCallback = (callback: () => void, options?: { timeout?: number }) => number;

let postRenderStarted = false;

const scheduleAfterFirstPaint = (task: () => void) => {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  const runWhenIdle = () => {
    const requestIdleCallback = (
      window as typeof window & {
        requestIdleCallback?: RequestIdleCallback;
      }
    ).requestIdleCallback;

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(task, { timeout: 1500 });
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

export const startPostRenderInitialization = () => {
  if (postRenderStarted) return;
  postRenderStarted = true;

  scheduleAfterFirstPaint(() => {
    setPostRenderReady(true);

    if (typeof window !== 'undefined' && !shouldSkipRoutePreload(window)) {
      void ensureBuiltinToolSurfaces().catch((error) => {
        console.error('[SPA Initialize] builtin tool surface preload failed', error);
      });
    }

    try {
      startConnectorInitialization();
    } catch (error) {
      console.error('[SPA Initialize] post-render initialization failed', error);
    }

    try {
      startRoutePreload();
    } catch (error) {
      console.error('[SPA Initialize] route preload initialization failed', error);
    }
  });
};
