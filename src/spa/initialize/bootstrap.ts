import { lazy } from 'react';
import { flushSync } from 'react-dom';

import { registerAcceptanceFramesView } from '@/features/Acceptance/Viewer/Frames/view';
import { openArtifactBoardModal } from '@/features/ArtifactBoard/loader';
import { registerArtifactBoardOpener } from '@/features/ArtifactBoard/opener';
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

  // Canvas-backed surfaces live outside the shared viewer modules; see each registry.
  registerArtifactBoardOpener((boardId) => void openArtifactBoardModal(boardId));
  registerAcceptanceFramesView(
    lazy(() =>
      import('@/features/Acceptance/Viewer/Frames/AcceptanceFrames').then((module) => ({
        default: module.AcceptanceFrames,
      })),
    ),
  );

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
