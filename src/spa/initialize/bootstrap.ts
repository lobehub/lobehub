import { flushSync } from 'react-dom';

import { startBootMetricsFinalize } from '@/libs/bootMetrics';
import { bootTiming } from '@/libs/bootTiming';

import { setAppReady } from '../atoms/app';
import { initializeApp } from '.';
import { startImportSettingsFromUrl } from './importSettings';
import { startPostRenderInitialization } from './postRender';
import { registerBuiltinToolSurfaces } from './toolSurfaces';

let started = false;

export const startAppInitialization = () => {
  if (started) return;
  started = true;

  // must run synchronously before first React render
  bootTiming.spanSync('import-settings', startImportSettingsFromUrl);
  bootTiming.spanSync('tool-surfaces', registerBuiltinToolSurfaces);

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
      startPostRenderInitialization();
      startBootMetricsFinalize();
    });
};
