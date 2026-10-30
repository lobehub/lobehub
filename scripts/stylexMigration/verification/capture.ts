import type { CDPSession, Page } from '@playwright/test';

import type { StyleSnapshot } from '../experiment/capture';
import { captureInPage } from '../experiment/capture';
import { createFastCapture } from '../experiment/fastCapture';

export interface ComponentSnapshot {
  attributes: Array<{ attributes: Array<[string, string]>; key: string; text: string }>;
  backend: 'hybrid' | 'strict';
  tree: StyleSnapshot;
}

export interface CaptureTiming {
  custom?: number;
  fast?: Record<string, number>;
  merge?: number;
  metadata?: number;
  standard?: number;
  total?: number;
}

export const captureComponent = async (
  page: Page,
  cdp: CDPSession,
  timing?: CaptureTiming,
): Promise<ComponentSnapshot> => {
  const started = performance.now();
  let phaseStarted = started;
  const { captureMetadata: metadata, ...prepared } = await page.evaluate(captureInPage, {
    animationTime: 0,
    collectMetadata: true,
  });
  if (!metadata) throw new Error('CAPTURE_PREPARATION_MISSING');
  if (timing) timing.metadata = performance.now() - phaseStarted;
  phaseStarted = performance.now();
  if (metadata.standard.join('\0') !== metadata.rootProperties.toSorted().join('\0')) {
    const tree = await page.evaluate(captureInPage, {});
    if (timing) {
      timing.standard = performance.now() - phaseStarted;
      timing.total = performance.now() - started;
    }
    return {
      attributes: metadata.attributes,
      backend: 'strict',
      tree,
    };
  }
  const capture = await createFastCapture(page, cdp, {
    properties: metadata.rootProperties,
    prepared,
    nodeStyles: metadata.custom.length > 0,
  });
  const tree = await capture(0, timing ? (timing.fast = {}) : undefined);
  if (timing) timing.standard = performance.now() - phaseStarted;
  // Keep the existing node-local schema for custom values. The decoder avoids
  // interning full 1k-property styles only to immediately expand them again.
  if (timing) timing.total = performance.now() - started;
  return { attributes: metadata.attributes, backend: 'hybrid', tree };
};
