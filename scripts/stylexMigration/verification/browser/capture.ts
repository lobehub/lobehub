import type { CDPSession, Page } from '@playwright/test';

import type { StyleSnapshot } from '../../../../packages/style-equivalence/src/capture/snapshot';
import { captureInPage } from '../../../../packages/style-equivalence/src/capture/snapshot';
import { createFastCapture } from './fastCapture';
import type { CaptureRoot, CaptureScope, CaptureSurface } from './surfaces';
import { resolveCaptureSurfacesInPage } from './surfaces';

export interface ComponentSnapshot {
  attributes: Array<{ attributes: Array<[string, string]>; key: string; text: string }>;
  backend: 'hybrid' | 'strict';
  scope?: CaptureScope;
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

const captureRoot = async (
  page: Page,
  cdp: CDPSession,
  timing?: CaptureTiming,
  root: CaptureRoot = { keyPrefix: '', selector: '[data-case-root]' },
): Promise<ComponentSnapshot> => {
  const started = performance.now();
  let phaseStarted = started;
  const scope = { ...root, originSelector: '[data-case-root]' };
  const { captureMetadata: metadata, ...prepared } = await page.evaluate(captureInPage, {
    ...scope,
    animationTime: 0,
    collectMetadata: true,
  });
  if (!metadata) throw new Error('CAPTURE_PREPARATION_MISSING');
  if (timing) timing.metadata = performance.now() - phaseStarted;
  phaseStarted = performance.now();
  if (metadata.standard.join('\0') !== metadata.rootProperties.toSorted().join('\0')) {
    const tree = await page.evaluate(captureInPage, scope);
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
    scope,
  });
  const tree = await capture(0, timing ? (timing.fast = {}) : undefined);
  if (timing) timing.standard = performance.now() - phaseStarted;
  // Keep the existing node-local schema for custom values. The decoder avoids
  // interning full 1k-property styles only to immediately expand them again.
  if (timing) timing.total = performance.now() - started;
  return { attributes: metadata.attributes, backend: 'hybrid', tree };
};

export const captureComponent = async (
  page: Page,
  cdp: CDPSession,
  timing?: CaptureTiming,
  options?: { surfaces: CaptureSurface[]; variant?: string },
): Promise<ComponentSnapshot> => {
  if (!options) return captureRoot(page, cdp, timing);
  const started = performance.now();
  const scope = await page.evaluate(resolveCaptureSurfacesInPage, options);
  if (scope.roots.length === 1) return { ...(await captureRoot(page, cdp, timing)), scope };
  const snapshots: ComponentSnapshot[] = [];
  // CDP marker inventories are document-local and must not race each other.
  for (const root of scope.roots) snapshots.push(await captureRoot(page, cdp, undefined, root));
  const tree: StyleSnapshot = {
    animations: [],
    durationMs: performance.now() - started,
    nodes: [],
    propertyReads: 0,
    styles: [],
  };
  for (const snapshot of snapshots) {
    const offset = tree.styles.length;
    tree.nodes.push(
      ...snapshot.tree.nodes.map((node) => ({ ...node, style: node.style + offset })),
    );
    tree.styles.push(...snapshot.tree.styles);
    tree.animations.push(...snapshot.tree.animations);
    tree.propertyReads += snapshot.tree.propertyReads;
  }
  if (timing) timing.total = performance.now() - started;
  return {
    attributes: snapshots.flatMap((snapshot) => snapshot.attributes),
    backend: snapshots.every((snapshot) => snapshot.backend === 'hybrid') ? 'hybrid' : 'strict',
    scope,
    tree,
  };
};
