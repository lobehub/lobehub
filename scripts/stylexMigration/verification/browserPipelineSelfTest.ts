import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import type { ComponentSnapshot } from './capture';
import { runFixtureComparison } from './componentRunner';
import { getStyleFixture } from './fixtureRegistry';
import { evaluateGate, exitCode } from './gate';
import { writeArtifactManifest } from './report';
import type { StyleBindingPlan } from './styleBindings';

const decompress = promisify(gunzip);

/** Controlled HTML tests the infrastructure only; it is not a component adapter. */
export const runBrowserPipelineSelfTest = async (output: string, browser?: string) => {
  const results = [];
  for (const mode of [
    'equal',
    'difference',
    'supplemental',
    'condition-intersection',
    'condition-fraction',
    'shards-complete',
    'shards-truncated',
    'shards-difference-truncated',
  ]) {
    const changed = mode === 'difference' || mode === 'shards-difference-truncated';
    const supplemental = mode === 'supplemental';
    const conditional = mode.startsWith('condition-');
    const sharded = mode.startsWith('shards-');
    const truncated = mode.endsWith('-truncated');
    const directory = path.join(output, `pipeline-${mode}`);
    const base = path.join(directory, 'base');
    const candidate = path.join(directory, 'candidate');
    await mkdir(base, { recursive: true });
    await mkdir(candidate);
    const html = (color: string, candidate = false) => {
      const conditionalCss =
        mode === 'condition-intersection'
          ? `@media (max-width:650px){@container card (max-width:550px){.row:hover>td{color:${candidate ? 'blue' : 'red'}}}}`
          : mode === 'condition-fraction'
            ? `@container card (599.2px < width < 599.4px){.row td{color:${candidate ? 'blue' : 'red'}}}`
            : '';
      const contextCheck = sharded
        ? `addEventListener('DOMContentLoaded',()=>{const count=Number(localStorage.getItem('visits')||0)+1;localStorage.setItem('visits',String(count));document.querySelector('[data-case-root]').setAttribute('data-context-visits',String(count));});`
        : '';
      return `<!doctype html><html><head><style>body{margin:0;font:14px Arial}td{color:${color}}tr:hover{background:yellow}${supplemental ? `.row:hover>td{background:red}${candidate ? '.row:nth-child(2):hover>td{background:blue}' : ''}` : ''}${conditionalCss}</style><script>Object.defineProperty(globalThis,'__styleVerificationBindings',{value:{styles:{row:'row'}}});Object.defineProperty(globalThis,'__styleVerificationCompositions',{value:{records:[],gaps:[]}});${contextCheck}</script></head><body><div id="app" data-verification-ready><main data-case-root data-verification-host><div data-component-mount><div style="container:card / inline-size"><table><tbody><tr class="row" tabindex="0"><td>Controlled infrastructure corpus</td></tr>${supplemental ? '<tr class="row" tabindex="0"><td>Second target</td></tr>' : ''}</tbody></table></div></div></main></div></body></html>`;
    };
    await writeFile(path.join(base, 'index.html'), html('red'), { flag: 'wx' });
    await writeFile(path.join(candidate, 'index.html'), html(changed ? 'blue' : 'red', true), {
      flag: 'wx',
    });
    const fixture = {
      ...getStyleFixture('LiteTable'),
      component: {
        id: 'infrastructure-corpus-no-react',
        base: { exportName: 'none', source: 'base/index.html' },
        candidate: { exportName: 'none', source: 'candidate/index.html' },
      },
      host: 'base/index.html',
      id: 'infrastructure-corpus',
      render: 'base/index.html',
      styleVariants: [{ expectedUnits: [], id: 'normal' }],
    };
    const comparison = await runFixtureComparison({
      bindingPlans:
        supplemental || conditional
          ? { base: controlledBindingPlan, candidate: controlledBindingPlan }
          : undefined,
      browser,
      builds: { base: { output: base }, candidate: { output: candidate } },
      fixture,
      output: directory,
      provenance: 'infrastructure-corpus',
      probeBudget: sharded ? { maxProbesPerShard: 1, maxShards: truncated ? 1 : 2 } : undefined,
      planConditions: conditional,
      probes: [
        {
          direction: 'ltr',
          id: 'normal:default',
          pseudo: 'default',
          variant: 'normal',
          width: 320,
        },
        { direction: 'rtl', id: 'normal:hover', pseudo: 'hover', variant: 'normal', width: 600 },
      ],
    });
    const gate = evaluateGate({
      errors: comparison.result.errors,
      findings: comparison.result.findings,
      fixtures: comparison.result.fixtureResults,
      fullScope: false,
      identityVerified: false,
      pureStyleMigration: false,
      units: [
        {
          componentId: 'infrastructure-corpus',
          fixtureIds: [],
          id: 'unresolved-source',
          requiredKeys: [],
        },
      ],
      witnesses: [],
    });
    await writeArtifactManifest(directory, [
      ...comparison.artifactFiles,
      'base/index.html',
      'candidate/index.html',
    ]);
    const expected = changed || supplemental || conditional ? 'FAIL' : 'NEEDS_REVIEW';
    const supplementPassed =
      !supplemental ||
      (comparison.result.supplemental.scheduled === 1 &&
        comparison.result.ruleCoverage?.missingActivationTargets === 0 &&
        comparison.result.results
          .slice(0, 2)
          .every((entry) => !entry.comparison.differences.length) &&
        comparison.result.results[2]?.confirmed === true);
    const conditionPassed =
      !conditional ||
      (comparison.result.results
        .slice(0, 2)
        .every((entry) => entry.comparison.differences.length === 0) &&
        comparison.result.results.slice(2).some((entry) => entry.confirmed) &&
        (mode === 'condition-fraction'
          ? comparison.result.conditionCoverage!.missing > 0
          : comparison.result.conditionCoverage!.missing === 0));
    let freshContexts = true;
    if (sharded)
      for (const file of comparison.result.results.flatMap((entry) => entry.evidenceRefs)) {
        const snapshot: ComponentSnapshot = JSON.parse(
          (await decompress(await readFile(path.join(directory, file)))).toString(),
        );
        freshContexts &&=
          snapshot.attributes
            .find((entry) => entry.key === 'root')
            ?.attributes.find(([name]) => name === 'data-context-visits')?.[1] === '1';
      }
    const shardsPassed =
      !sharded ||
      (freshContexts &&
        comparison.result.probeShards.shards === (truncated ? 1 : 2) &&
        comparison.result.probeShards.completedShards === (truncated ? 1 : 2) &&
        comparison.result.probeShards.failedShards === 0 &&
        comparison.result.unexecutedProbeIds.length === (truncated ? 1 : 0) &&
        comparison.result.findings.some(
          (entry) => entry.reasonCode === 'PROBE_SHARD_COUNT_BUDGET_EXCEEDED',
        ) === truncated);
    results.push({
      actual: gate.status,
      aaStable: comparison.result.fixtureResults.every((entry) => entry.aaStable),
      browserIdentity: comparison.result.browser,
      confirmed: comparison.result.results.filter((entry) => entry.confirmed).length,
      exitCode: exitCode(gate.status),
      expected,
      gateEligible: gate.gateEligible,
      supplemental: comparison.result.supplemental,
      conditionCoverage: comparison.result.conditionCoverage,
      probeShards: comparison.result.probeShards,
      freshContexts,
      passed:
        gate.status === expected &&
        !gate.gateEligible &&
        (conditional ||
          comparison.result.results.length === (supplemental ? 3 : truncated ? 1 : 2)) &&
        comparison.result.fixtureResults.every((entry) => entry.aaStable) &&
        !comparison.result.errors.length &&
        (truncated || !comparison.result.unexecutedProbeIds.length) &&
        supplementPassed &&
        conditionPassed &&
        shardsPassed,
      report: path.relative(output, path.join(directory, 'component-run.json')),
    });
  }
  return {
    results,
    summary: { cases: results.length, failed: results.filter((result) => !result.passed).length },
  };
};

const controlledBindingPlan: StyleBindingPlan = {
  bindings: [
    {
      kind: 'css-module',
      symbol: 'styles',
      slots: [{ name: 'row', start: 0, end: 1, unitId: 'controlled-row' }],
    },
  ],
  gaps: [],
  source: 'controlled.html',
  sourceHash: 'controlled',
  stylesheets: [],
};
