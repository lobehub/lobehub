import type { Browser } from '@playwright/test';

import { compareWithProbes, discoverProbes } from '../browser/probes';
import { captureInPage, compareSnapshots } from '../browser/snapshot';
import { boundaries, boundaryHtml } from './boundaries';

export const runBoundaryMatrix = async (
  browser: Browser,
  only?: string,
  backend: 'strict' | 'fast' = 'strict',
) => {
  const started = performance.now();
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const results = [];
  try {
    for (const entry of boundaries.filter((entry) => !only || entry.id === only)) {
      const caseStarted = performance.now();
      await Promise.all(
        pages.map(async (page, index) => {
          await page.setViewportSize({ height: 900, width: 1200 });
          await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
          await page.setContent(boundaryHtml(entry, index ? 'after' : 'before'));
          if (entry.setup) await page.evaluate(entry.setup);
        }),
      );
      const defaultSnapshots = await Promise.all(
        pages.map((page) => page.evaluate(captureInPage, {})),
      );
      const defaultDifferences = compareSnapshots(defaultSnapshots[0], defaultSnapshots[1]);
      const plan = await discoverProbes(pages);
      const comparison = await compareWithProbes(pages, plan, backend);
      const detectingProbes = comparison.results.filter((probe) => probe.differenceCount > 0);
      const uncovered = comparison.coverage.flatMap((coverage) => coverage.unwitnessed);
      const decision = detectingProbes.length
        ? 'different'
        : plan.unsupported.length || uncovered.length
          ? 'feedback'
          : 'equal';
      results.push({
        coverage: comparison.coverage,
        decision,
        defaultDifferenceCount: defaultDifferences.length,
        detectingProbes,
        durationMs: performance.now() - caseStarted,
        expected: entry.expected,
        feature: entry.feature,
        id: entry.id,
        probeCount: plan.probes.length,
        propertyReads: comparison.results.reduce((sum, result) => sum + result.propertyReads, 0),
        unsupported: plan.unsupported,
      });
      console.log(
        JSON.stringify({
          matrix: entry.id,
          decision,
          defaultDifferences: defaultDifferences.length,
          probes: plan.probes.length,
        }),
      );
    }
  } finally {
    await Promise.all(pages.map((page) => page.close()));
  }
  const changed = results.filter((result) => result.expected === 'changed');
  const controls = results.filter((result) => result.expected === 'equivalent');
  return {
    durationMs: performance.now() - started,
    results,
    summary: {
      changed: changed.length,
      controls: controls.length,
      defaultDetected: changed.filter((result) => result.defaultDifferenceCount > 0).length,
      detected: changed.filter((result) => result.decision === 'different').length,
      feedback: changed.filter((result) => result.decision === 'feedback').length,
      falseEqual: changed.filter((result) => result.decision === 'equal').length,
      falsePositive: controls.filter((result) => result.decision === 'different').length,
      controlsEqual: controls.filter((result) => result.decision === 'equal').length,
      properties: results.reduce((sum, result) => sum + result.propertyReads, 0),
    },
  };
};
