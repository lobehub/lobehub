import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { StyleBindingPlan } from '../analysis/styleBindings';
import { getStyleFixture } from '../fixtures/fixtureRegistry';
import { evaluateGate } from '../gate/gate';
import { runFixtureComparison } from '../pipeline/componentRunner';
import { writeArtifactManifest, writeJson } from '../reporting/report';

/** Browser-only infrastructure regression, deliberately outside app CI discovery. */
export const runPortalSelfTest = async (output: string, browser?: string) => {
  const results = [];
  for (const mode of ['equal', 'quota-fill', 'position', 'missing', 'hover-second', 'media']) {
    const interactive = mode === 'hover-second';
    const conditional = mode === 'media';
    const directory = path.join(output, `portal-${mode}`);
    const base = path.join(directory, 'base');
    const candidate = path.join(directory, 'candidate');
    await mkdir(base, { recursive: true });
    await mkdir(candidate, { recursive: true });
    const html = (after: boolean) => `<!doctype html><html><head><style>
      body{margin:0;font:14px Arial}.popup{position:absolute;top:60px;left:${after && mode === 'position' ? 40 : 20}px;width:292px}
      .track{height:6px;border-radius:999px;background:#eee}.fill{height:${after && mode === 'quota-fill' ? 0 : 100}%;border-radius:inherit;background:${after && mode === 'quota-fill' ? 'transparent' : 'green'}}
      .low{background:${after && mode === 'quota-fill' ? 'transparent' : 'orange'}}
      ${interactive ? `.fill:hover{background:green}${after ? '.fill.low:hover{background:blue}' : ''}` : ''}
      ${conditional ? `@media(max-width:650px){.fill{background:${after ? 'blue' : 'green'}}}` : ''}
      </style><script>Object.defineProperty(globalThis,'__styleVerificationBindings',{value:{styles:{fill:'fill'}}});Object.defineProperty(globalThis,'__styleVerificationCompositions',{value:{records:[],gaps:[]}});</script></head><body><div data-verification-ready><main data-case-root data-verification-host><div data-component-mount><div><button aria-expanded="true">Quota</button></div></div></main></div>
      ${after && mode === 'missing' ? '' : '<section class="popup" data-quota-popup><div class="track"><div class="fill" style="width:81%"></div></div><div class="track"><div class="fill low" style="width:12%"></div></div></section>'}
      </body></html>`;
    await writeFile(path.join(base, 'index.html'), html(false));
    await writeFile(path.join(candidate, 'index.html'), html(true));
    const fixture = {
      ...getStyleFixture('DotsLoading'),
      id: 'portal-corpus',
      styleVariants: [{ expectedUnits: [], id: 'normal' }],
      surfaces: [
        ...getStyleFixture('DotsLoading').surfaces,
        { id: 'quota-popup', kind: 'portal' as const, selector: '[data-quota-popup]' },
      ],
    };
    let actual = 'ERROR';
    let differenceCount = 0;
    let aaStable = false;
    let supplementalConfirmed = false;
    let conditionalConfirmed = false;
    const artifacts = ['base/index.html', 'candidate/index.html'];
    let message: string | undefined;
    try {
      const comparison = await runFixtureComparison({
        bindingPlans:
          interactive || conditional ? { base: bindingPlan, candidate: bindingPlan } : undefined,
        browser,
        builds: { base: { output: base }, candidate: { output: candidate } },
        fixture,
        output: directory,
        probes: [
          { direction: 'ltr', id: 'normal', pseudo: 'default', variant: 'normal', width: 320 },
        ],
        provenance: 'infrastructure-corpus',
        planConditions: conditional,
      });
      artifacts.push(...comparison.artifactFiles);
      actual = evaluateGate({
        errors: comparison.result.errors,
        findings: comparison.result.findings,
        fixtures: comparison.result.fixtureResults,
        fullScope: false,
        identityVerified: false,
        pureStyleMigration: false,
        units: [],
        witnesses: [],
      }).status;
      differenceCount = comparison.result.results.reduce(
        (sum, result) => sum + result.comparison.differences.length,
        0,
      );
      aaStable = comparison.result.results.every((result) => result.aaStable);
      supplementalConfirmed = comparison.result.results.some(
        (result) => result.probe.interaction?.key.startsWith('surface:') && result.confirmed,
      );
      conditionalConfirmed = comparison.result.results.some(
        (result) => (result.probe.viewportWidth ?? 1200) <= 650 && result.confirmed,
      );
    } catch (error) {
      console.error('Portal regression case:', mode, error);
      message = error instanceof Error ? error.message : String(error);
      artifacts.push('component-error.json');
    }
    await writeArtifactManifest(directory, artifacts);
    const expected = mode === 'missing' ? 'ERROR' : mode === 'equal' ? 'NEEDS_REVIEW' : 'FAIL';
    results.push({
      actual,
      expected,
      aaStable,
      differenceCount,
      message,
      mode,
      supplementalConfirmed,
      conditionalConfirmed,
      passed:
        actual === expected &&
        (mode === 'missing' ? message?.includes('SURFACE_NOT_MOUNTED:quota-popup') : aaStable) &&
        (!interactive || supplementalConfirmed) &&
        (!conditional || conditionalConfirmed),
    });
  }
  const report = {
    results,
    summary: { cases: results.length, failed: results.filter((result) => !result.passed).length },
  };
  await writeJson(output, 'portals.json', report);
  return report;
};

const bindingPlan: StyleBindingPlan = {
  bindings: [
    {
      kind: 'css-module',
      symbol: 'styles',
      slots: [{ name: 'fill', start: 0, end: 1, unitId: 'quota-fill' }],
    },
  ],
  gaps: [],
  source: 'corpus.css',
  sourceHash: 'controlled',
  stylesheets: [],
};
