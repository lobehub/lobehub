import path from 'node:path';

import { chromium } from '@playwright/test';

import {
  captureInPage,
  compareSnapshots,
} from '../../../../packages/style-equivalence/src/capture/snapshot';
import { createFastCapture } from '../browser/fastCapture';
import { createProbeDriver } from '../browser/probes';
import { writeArtifactManifest, writeHtmlReport, writeJson } from '../reporting/report';
import { boundaries, boundaryHtml } from './boundaries';
import { runCapturePreparationSelfTest } from './capturePreparationSelfTest';
import { runCollectorSelfTest } from './collectorSelfTest';
import { runBoundaryMatrix } from './matrix';
import { runRuleWitnessSelfTest } from './ruleWitnessSelfTest';
import { runSurfaceSelfTest } from './surfaceSelfTest';

/** The prototype corpus remains regression evidence, never a whole-PR PASS. */
export const runSelfTest = async (
  output: string,
  verifierHash: string,
  executablePath?: string,
) => {
  const browser = await chromium.launch({
    env: { LANG: 'en_US.UTF-8', PATH: process.env.PATH, TZ: 'UTC' },
    executablePath,
    headless: true,
    timeout: 15_000,
  });
  try {
    const started = performance.now();
    const strict = await runBoundaryMatrix(browser, undefined, 'strict');
    const fast = await runBoundaryMatrix(browser, undefined, 'fast');
    const regressions: string[] = [];
    for (const backend of [strict, fast]) {
      if (
        backend.results.length !== boundaries.length ||
        new Set(backend.results.map((entry) => entry.id)).size !== boundaries.length
      )
        regressions.push('CORPUS_INCOMPLETE');
      for (const entry of backend.results) {
        const expected =
          entry.id === 'highlight'
            ? 'feedback'
            : entry.expected === 'equivalent'
              ? 'equal'
              : 'different';
        if (entry.decision !== expected)
          regressions.push(`${entry.id}:${entry.decision}:expected-${expected}`);
      }
    }
    for (const entry of fast.results)
      if (entry.decision !== strict.results.find((value) => value.id === entry.id)?.decision)
        regressions.push(`BACKEND_DECISION_MISMATCH:${entry.id}`);
    const collector = await runCollectorSelfTest(browser);
    for (const entry of collector.results)
      if (!entry.passed) regressions.push(`COLLECTOR_REGRESSION:${entry.id}`);
    const capturePreparation = await runCapturePreparationSelfTest(browser);
    if (capturePreparation.summary.failed) regressions.push('CAPTURE_PREPARATION_REGRESSION');
    const ruleWitness = await runRuleWitnessSelfTest(browser);
    if (ruleWitness.summary.failed) regressions.push('RULE_WITNESS_REGRESSION');
    const surfaces = await runSurfaceSelfTest(browser);
    if (surfaces.summary.failed) regressions.push('CAPTURE_SURFACE_REGRESSION');

    const parity: Array<{ caseId: string; differences: number; nodes: number; side: string }> = [];
    const page = await browser.newPage();
    try {
      await page.route('**/*', (route) => route.abort());
      for (const entry of boundaries) {
        for (const side of ['before', 'after'] as const) {
          await page.setContent(boundaryHtml(entry, side));
          if (entry.setup) await page.evaluate(entry.setup);
          const driver = await createProbeDriver(page);
          try {
            const capture = await createFastCapture(page, driver.cdp);
            const properties = await page.evaluate(() =>
              [...getComputedStyle(document.querySelector('[data-case-root]')!)].filter(
                (property) => !property.startsWith('--'),
              ),
            );
            const js = await page.evaluate(captureInPage, { properties });
            const hybrid = await capture();
            const differences = compareSnapshots(js, hybrid);
            parity.push({
              caseId: entry.id,
              differences: differences.length,
              nodes: js.nodes.length,
              side,
            });
            if (differences.length || !js.nodes.length)
              regressions.push(`BACKEND_TREE_MISMATCH:${entry.id}:${side}`);
          } finally {
            await driver.dispose();
          }
        }
      }
    } finally {
      await page.close();
    }
    const result = {
      browserVersion: browser.version(),
      corpus: { fast: fast.summary, strict: strict.summary },
      collector: collector.summary,
      capturePreparation: capturePreparation.summary,
      ruleWitness: ruleWitness.summary,
      surfaces: surfaces.summary,
      durationMs: performance.now() - started,
      mode: 'self-test',
      parity: {
        comparisons: parity.length,
        mismatching: parity.filter((entry) => entry.differences > 0).length,
      },
      regressions,
      runtime: process.version,
      schemaVersion: 1,
      status: regressions.length ? ('FAIL' as const) : ('PASS' as const),
      verifierHash,
    };
    await writeJson(output, 'strict.json', strict);
    await writeJson(output, 'fast.json', fast);
    await writeJson(output, 'parity.json', parity);
    await writeJson(output, 'collector.json', collector);
    await writeJson(output, 'capture-preparation.json', capturePreparation);
    await writeJson(output, 'rule-witness.json', ruleWitness);
    await writeJson(output, 'surfaces.json', surfaces);
    await writeJson(output, 'self-test.json', result);
    await writeHtmlReport(output, result);
    await writeArtifactManifest(output, [
      'strict.json',
      'fast.json',
      'parity.json',
      'collector.json',
      'capture-preparation.json',
      'rule-witness.json',
      'surfaces.json',
      'self-test.json',
      'report.html',
    ]);
    console.log(`Self-test report: ${path.join(output, 'report.html')}`);
    return result;
  } finally {
    await browser.close();
  }
};
