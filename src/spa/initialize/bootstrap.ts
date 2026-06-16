import { flushSync } from 'react-dom';

import { setAppReady } from '../atoms/app';
import { initializeApp } from '.';
import { startSWRCacheScopeSync } from './cacheScope';
import { startImportSettingsFromUrl } from './importSettings';
import { startPostRenderInitialization } from './postRender';
import { registerBuiltinToolSurfaces } from './toolSurfaces';

let started = false;

export const startAppInitialization = () => {
  if (started) return;
  started = true;

  startSWRCacheScopeSync();
  startImportSettingsFromUrl();
  registerBuiltinToolSurfaces();

  void initializeApp()
    .catch((error) => {
      console.error('[SPA Initialize] failed', error);
    })
    .finally(() => {
      flushSync(() => {
        setAppReady(true);
      });
      startPostRenderInitialization();
    });
};
