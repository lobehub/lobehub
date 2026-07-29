import { flushSync } from 'react-dom';

import { startBootMetricsFinalize } from '@/libs/bootMetrics';
import { bootTiming } from '@/libs/bootTiming';

import { setAppReady } from '../atoms/app';
import { initializeApp } from '.';
import { startImportSettingsFromUrl } from './importSettings';

let started = false;

const loadPostRenderInitialization = async () => {
  try {
    const { startPostRenderInitialization } = await import('./postRender');
    startPostRenderInitialization();
  } catch (error) {
    console.error('[SPA Initialize] failed to load post-render initialization', error);
  }
};

export const startAppInitialization = () => {
  if (started) return;
  started = true;

  // must run synchronously before first React render
  bootTiming.spanSync('import-settings', startImportSettingsFromUrl);

  void bootTiming
    .span('core-init', initializeApp)
    .catch((error) => {
      console.error('[SPA Initialize] failed', error);
    })
    .finally(() => {
      flushSync(() => {
        setAppReady(true);
      });
      bootTiming.mark('app-ready');
      void loadPostRenderInitialization();
      startBootMetricsFinalize();
    });
};
