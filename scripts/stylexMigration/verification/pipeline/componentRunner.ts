import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import type { Browser, CDPSession, Page } from '@playwright/test';
import { chromium } from '@playwright/test';

import { summarizeConditionCoverage } from '../analysis/conditionCoverage';
import type { ConditionProbePlan } from '../analysis/conditionProbePlanner';
import { planConditionProbes, readConditionHostInPage } from '../analysis/conditionProbePlanner';
import type { RuleProbeEvidence } from '../analysis/ruleCoverage';
import { summarizeRuleCoverage } from '../analysis/ruleCoverage';
import type { RuleWitnessPlan } from '../analysis/ruleWitnesses';
import {
  collectRuleWitnessesInPage,
  planRuleWitnesses,
  readRuntimeBindings,
} from '../analysis/ruleWitnesses';
import type { StyleBindingPlan } from '../analysis/styleBindings';
import { planSupplementalProbes } from '../analysis/supplementalProbes';
import type { CaptureTiming } from '../browser/capture';
import { captureComponent } from '../browser/capture';
import { compareComponents } from '../browser/compareSnapshots';
import { collectRulesInPage } from '../browser/ruleInventory';
import { readRuntimeCompositions } from '../browser/runtimeCompositions';
import { captureScreenshotEvidence } from '../browser/screenshotEvidence';
import { buildComponentFixture } from '../build/buildFixtures';
import { digestFile } from '../dependencies/dependencySnapshot';
import type { StyleFixture } from '../fixtures/fixtureRegistry';
import { serveFixtures } from '../fixtures/fixtureServer';
import { sha256, writeJson } from '../reporting/report';
import type { GateInput } from '../types';
import type { FixtureProbe } from './probePlanner';
import { planFixtureProbes } from './probePlanner';
import type { ProbeShardBudget } from './probeShards';
import { createProbeShardController } from './probeShards';

const compress = promisify(gzip);

interface ProbeResult {
  aaDifferences: ReturnType<typeof compareComponents>['raw'];
  aaStable: boolean;
  captureTiming: CaptureTiming[];
  comparison: ReturnType<typeof compareComponents>;
  confirmation?: ReturnType<typeof compareComponents>;
  confirmationCaptureTiming?: CaptureTiming;
  confirmed: boolean;
  evidenceRefs: string[];
  measured: number[];
  probe: FixtureProbe;
  shardId: string;
  timing: Record<
    | 'setup'
    | 'inventory'
    | 'capture'
    | 'comparison'
    | 'persist'
    | 'confirmation'
    | 'witness'
    | 'planning',
    number
  >;
}

const openPage = async (browser: Browser, origin: string, failures: Set<string>) => {
  const context = await browser.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
    timezoneId: 'UTC',
    viewport: { height: 900, width: 1200 },
  });
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === origin) await route.continue();
    else {
      failures.add(`EXTERNAL_REQUEST_BLOCKED:${route.request().resourceType()}`);
      await route.abort();
    }
  });
  const page = await context.newPage();
  await page.routeWebSocket('**/*', (socket) => socket.close());
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => failures.add(`PAGE_ERROR:${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.add(`ASSET_HTTP_ERROR:${response.status()}`);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  return { cdp, context, page };
};

const applyProbe = async (
  page: Page,
  cdp: CDPSession,
  origin: string,
  side: string,
  probe: FixtureProbe,
  fixture: StyleFixture,
) => {
  const viewportWidth = probe.viewportWidth ?? 1200;
  if (page.viewportSize()?.width !== viewportWidth)
    await page.setViewportSize({ width: viewportWidth, height: 900 });
  // A navigation resets prior forced nodes, inline overrides, focus and animation.
  await page.goto(`${origin}/${side}/?variant=${encodeURIComponent(probe.variant)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('[data-verification-ready]', { state: 'attached' });
  const measured = await page.evaluate(
    async ({ direction, width, settleFrames }) => {
      document.documentElement.dir = direction;
      const host = document.querySelector<HTMLElement>('[data-component-mount]');
      if (!host) throw new Error('FIXTURE_HOST_MISSING');
      host.style.width = `${width}px`;
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
      for (let frame = 0; frame < settleFrames; frame++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const container = host.firstElementChild;
      if (!(container instanceof HTMLElement)) throw new Error('COMPONENT_NOT_MOUNTED');
      const computed = getComputedStyle(container);
      const measured =
        Number.parseFloat(computed.width) -
        (computed.boxSizing === 'border-box'
          ? Number.parseFloat(computed.paddingLeft) +
            Number.parseFloat(computed.paddingRight) +
            Number.parseFloat(computed.borderLeftWidth) +
            Number.parseFloat(computed.borderRightWidth)
          : 0);
      if (!Number.isFinite(measured)) throw new Error('CONTROLLED_CONTENT_WIDTH_UNRESOLVED');
      return measured;
    },
    { ...probe, settleFrames: fixture.settleFrames },
  );
  if (probe.interaction || probe.pseudo !== 'default') {
    const selector = probe.interaction
      ? await page.evaluate(({ key, tag }) => {
          if (!/^root(?:\.\d+)*$/.test(key)) throw new Error('INVALID_TRIGGER_KEY');
          let element = document.querySelector('[data-case-root]');
          for (const index of key.split('.').slice(1).map(Number))
            element = element
              ? [...element.children].filter(
                  (child) => !['LINK', 'META', 'SCRIPT', 'STYLE'].includes(child.tagName),
                )[index]
              : null;
          if (!element || element.tagName !== tag)
            throw new Error('PAIRED_TRIGGER_STRUCTURE_MISMATCH');
          const segments: string[] = [];
          for (
            let current: Element | null = element;
            current?.parentElement;
            current = current.parentElement
          )
            segments.unshift(
              `:nth-child(${[...current.parentElement.children].indexOf(current) + 1})`,
            );
          return [':root', ...segments].join(' > ');
        }, probe.interaction)
      : (fixture.interactionSelectors[probe.pseudo as 'hover' | 'focus-visible'] ??
        fixture.defaultInteractionSelector);
    if (!selector) throw new Error('PSEUDO_TRIGGER_CONTRACT_MISSING');
    const documentNode = await cdp.send('DOM.getDocument');
    const target = await cdp.send('DOM.querySelector', {
      nodeId: documentNode.root.nodeId,
      selector,
    });
    if (!target.nodeId) throw new Error('PSEUDO_TRIGGER_NOT_MOUNTED');
    await cdp.send('CSS.forcePseudoState', {
      forcedPseudoClasses: [probe.interaction?.state ?? probe.pseudo],
      nodeId: target.nodeId,
    });
  }
  return measured;
};

export const runComponentFixture = async (options: {
  baseRoot: string;
  browser?: string;
  candidateRoot: string;
  fixture: StyleFixture;
  output: string;
  sourceDirectory: string;
  screenshots?: boolean;
}) => {
  const { fixture, output } = options;
  const builds = {
    base: await buildComponentFixture(options.baseRoot, options.sourceDirectory, fixture, 'base'),
    candidate: await buildComponentFixture(
      options.candidateRoot,
      options.sourceDirectory,
      fixture,
      'candidate',
    ),
  };
  await writeJson(output, 'fixture-builds.json', builds);
  const result = await runFixtureComparison({
    browser: options.browser,
    builds,
    bindingPlans: { base: builds.base.bindingPlan, candidate: builds.candidate.bindingPlan },
    fixture,
    output,
    provenance: 'component-build',
    screenshots: options.screenshots,
  });
  return { ...result, artifactFiles: ['fixture-builds.json', ...result.artifactFiles] };
};

/** Lower-level browser integration; callers cannot turn this into a gate approval. */
export const runFixtureComparison = async (options: {
  browser?: string;
  bindingPlans?: { base: StyleBindingPlan; candidate: StyleBindingPlan };
  builds: { base: { output: string }; candidate: { output: string } };
  fixture: StyleFixture;
  output: string;
  probes?: FixtureProbe[];
  probeBudget?: Partial<ProbeShardBudget>;
  planConditions?: boolean;
  provenance: 'component-build' | 'infrastructure-corpus';
  screenshots?: boolean;
}) => {
  const { builds, fixture, output } = options;
  const started = performance.now();
  if (options.probeBudget && options.provenance !== 'infrastructure-corpus')
    throw new Error('UNTRUSTED_PROBE_BUDGET_OVERRIDE');
  const shardController = createProbeShardController({ budget: options.probeBudget });
  const probes = [...(options.probes ?? planFixtureProbes(fixture))];
  const planConditions = options.planConditions ?? (!!fixture.sizeContract && !options.probes);
  if (planConditions && !fixture.sizeContract) throw new Error('CONDITION_SIZE_CONTRACT_REQUIRED');
  await writeJson(output, 'probe-plan.json', {
    coverageMode: 'declared-discrete-host-contract',
    gaps: ['CONDITION_IR_UNPLANNED', 'SOURCE_UNIT_BINDING_UNPROVEN'],
    probes,
  });
  const server = await serveFixtures({
    base: builds.base.output,
    candidate: builds.candidate.output,
  });
  let browser: Browser | undefined;
  const failures = new Set<string>();
  const findings: GateInput['findings'] = [
    {
      confirmed: false,
      id: 'font-contract',
      reasonCode: 'PRODUCTION_FONT_METRICS_UNVERIFIED',
      severity: 'review',
    },
  ];
  const fixtureResults: GateInput['fixtures'] = [];
  const artifactFiles = ['probe-plan.json'];
  const results: ProbeResult[] = [];
  const screenshots: Array<{
    probeId: string;
    result: Awaited<ReturnType<typeof captureScreenshotEvidence>>;
  }> = [];
  const rulePlans: Array<{ plan: RuleWitnessPlan; side: 'base' | 'candidate'; variant: string }> =
    [];
  const ruleEvidence: RuleProbeEvidence[] = [];
  const supplementalPlans: Array<ReturnType<typeof planSupplementalProbes> & { variant: string }> =
    [];
  const conditionPlans: ConditionProbePlan[] = [];
  try {
    browser = await chromium.launch({
      args: ['--enable-automation'],
      env: { LANG: 'en_US.UTF-8', PATH: process.env.PATH, TZ: 'UTC' },
      executablePath: options.browser,
      headless: true,
      timeout: 15_000,
    });
    const session = await browser.newBrowserCDPSession();
    const command = await session.send('Browser.getBrowserCommandLine');
    const binary = command.arguments[0];
    if (!binary || !path.isAbsolute(binary)) throw new Error('BROWSER_BINARY_IDENTITY_UNRESOLVED');
    const browserIdentity = { binaryHash: await digestFile(binary), version: browser.version() };
    await session.detach();
    let pages: Array<Awaited<ReturnType<typeof openPage>>> = [];
    const savedSnapshots = new Set<string>();
    const saveSnapshot = async (snapshot: Awaited<ReturnType<typeof captureComponent>>) => {
      const data = JSON.stringify({ ...snapshot, tree: { ...snapshot.tree, durationMs: 0 } });
      const file = `snapshot-${sha256(data)}.json.gz`;
      if (!savedSnapshots.has(file)) {
        savedSnapshots.add(file);
        await writeFile(path.join(output, file), await compress(data), { flag: 'wx' });
        artifactFiles.push(file);
      }
      return file;
    };
    for (const variant of fixture.styleVariants) {
      const variantStarted = performance.now();
      let stable = true;
      let count = 0;
      let nodes = Infinity;
      let reads = 0;
      const variantProbes = probes.filter((entry) => entry.variant === variant.id);
      const initialCount = variantProbes.length;
      for (let probeIndex = 0; probeIndex < variantProbes.length; probeIndex++) {
        const probe = variantProbes[probeIndex];
        const timing: ProbeResult['timing'] = {
          setup: 0,
          inventory: 0,
          capture: 0,
          comparison: 0,
          persist: 0,
          confirmation: 0,
          witness: 0,
          planning: 0,
        };
        const assignment = shardController.beginProbe(probe.id, variant.id);
        if (!assignment) break;
        let phaseStarted = performance.now();
        if (assignment.newShard) {
          await shardController.runOperation(() =>
            Promise.all(pages.map((entry) => entry.context.close())),
          );
          pages = await shardController.runOperation(() =>
            Promise.all(
              Array.from({ length: 4 }, () => openPage(browser!, server.origin, failures)),
            ),
          );
        }
        const measured = await shardController.runOperation(() =>
          Promise.all(
            pages
              .slice(0, 3)
              .map((entry, index) =>
                applyProbe(
                  entry.page,
                  entry.cdp,
                  server.origin,
                  index === 2 ? 'candidate' : 'base',
                  probe,
                  fixture,
                ),
              ),
          ),
        );
        timing.setup = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        if (measured.some((width) => Math.abs(width - probe.width) > 0.05))
          findings.push({
            confirmed: false,
            id: `${probe.id}:content-size`,
            reasonCode: 'CONTAINER_CONTENT_SIZE_MISMATCH',
            severity: 'review',
          });
        if (count === 0) {
          for (const index of [0, 2]) {
            const file = `rules-${variant.id}-${index === 0 ? 'base' : 'candidate'}.json`;
            const inventory = await shardController.runOperation(() =>
              pages[index].page.evaluate(collectRulesInPage),
            );
            await writeJson(output, file, inventory);
            artifactFiles.push(file);
            if (options.bindingPlans) {
              const side = index === 0 ? ('base' as const) : ('candidate' as const);
              const bindings = await shardController.runOperation(() =>
                readRuntimeBindings(pages[index].page),
              );
              const compositions = await shardController.runOperation(() =>
                readRuntimeCompositions(pages[index].page),
              );
              const plan = planRuleWitnesses(
                inventory,
                options.bindingPlans[side],
                bindings,
                compositions,
              );
              const planFile = `rule-plan-${variant.id}-${side}.json`;
              await writeJson(output, planFile, { bindings, compositions, plan });
              artifactFiles.push(planFile);
              rulePlans.push({ plan, side, variant: variant.id });
            }
            inventory.gaps.forEach((gap, gapIndex) =>
              findings.push({
                confirmed: false,
                id: `${variant.id}:${index}:rule-gap:${gapIndex}`,
                reasonCode: gap,
                severity: 'review',
              }),
            );
          }
        }
        timing.inventory = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        const captureTiming: CaptureTiming[] = [{}, {}, {}];
        const [base, aa, candidate] = await shardController.runOperation(() =>
          Promise.all(
            pages
              .slice(0, 3)
              .map((entry, index) => captureComponent(entry.page, entry.cdp, captureTiming[index])),
          ),
        );
        timing.capture = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        const control = compareComponents(base, aa);
        const comparison = compareComponents(base, candidate);
        timing.comparison = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        const evidenceRefs = await Promise.all([base, aa, candidate].map(saveSnapshot));
        timing.persist = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        const aaStable = control.raw.length === 0;
        stable &&= aaStable;
        let confirmed = false;
        let confirmation;
        let confirmationCaptureTiming: CaptureTiming | undefined;
        if (comparison.differences.length && aaStable) {
          await shardController.runOperation(() =>
            applyProbe(pages[3].page, pages[3].cdp, server.origin, 'candidate', probe, fixture),
          );
          const repeated = await shardController.runOperation(() =>
            captureComponent(pages[3].page, pages[3].cdp, (confirmationCaptureTiming = {})),
          );
          confirmation = compareComponents(aa, repeated);
          evidenceRefs.push(await saveSnapshot(repeated));
          confirmed =
            JSON.stringify(comparison.differences) === JSON.stringify(confirmation.differences);
        }
        timing.confirmation = performance.now() - phaseStarted;
        if (
          options.screenshots &&
          screenshots.length < 3 &&
          (screenshots.length === 0 || comparison.raw.length > 0)
        ) {
          const image = await shardController.runOperation(() =>
            captureScreenshotEvidence(
              pages.slice(0, 3).map((entry) => entry.page),
              output,
              `pixels-${screenshots.length}`,
            ),
          );
          screenshots.push({ probeId: probe.id, result: image });
          artifactFiles.push(...image.artifactFiles);
        }
        phaseStarted = performance.now();
        if (comparison.differences.length)
          findings.push({
            confirmed,
            id: `${probe.id}:difference`,
            reasonCode: confirmed ? 'COMPONENT_STYLE_DIFFERENCE' : 'UNSTABLE_DIFFERENCE',
            severity: 'difference',
          });
        if (comparison.review.length)
          findings.push({
            confirmed: false,
            id: `${probe.id}:custom-properties`,
            reasonCode: 'CUSTOM_PROPERTY_CONSUMERS_UNPROVEN',
            severity: 'review',
          });
        if (options.bindingPlans) {
          for (const index of [0, 2]) {
            const side = index === 0 ? ('base' as const) : ('candidate' as const);
            const plan = rulePlans.find(
              (entry) => entry.side === side && entry.variant === variant.id,
            )?.plan;
            if (!plan) throw new Error('RULE_WITNESS_PLAN_MISSING');
            const observation = await shardController.runOperation(() =>
              pages[index].page.evaluate(collectRuleWitnessesInPage, {
                nonce: randomBytes(8).toString('hex'),
                rules: plan.rules,
              }),
            );
            ruleEvidence.push({
              evidenceRefs,
              observation,
              probeId: probe.id,
              side,
              variant: variant.id,
            });
          }
        }
        timing.witness = performance.now() - phaseStarted;
        phaseStarted = performance.now();
        results.push({
          aaDifferences: control.raw,
          aaStable,
          comparison,
          confirmation,
          confirmed,
          evidenceRefs,
          measured,
          probe,
          shardId: assignment.shardId,
          captureTiming,
          confirmationCaptureTiming,
          timing,
        });
        count++;
        nodes = Math.min(nodes, base.tree.nodes.length, candidate.tree.nodes.length);
        reads += base.tree.propertyReads + aa.tree.propertyReads + candidate.tree.propertyReads;
        if (options.bindingPlans && planConditions && count === 1 && fixture.sizeContract) {
          const seeds = await Promise.all(
            [0, 2].map(async (index) => {
              const side = index === 0 ? ('base' as const) : ('candidate' as const);
              const plan = rulePlans.find(
                (entry) => entry.side === side && entry.variant === variant.id,
              )!.plan;
              const observation = ruleEvidence.find(
                (entry) => entry.side === side && entry.probeId === probe.id,
              )!.observation;
              return {
                ...(await pages[index].page.evaluate(readConditionHostInPage, {
                  'hover': fixture.interactionSelectors.hover ?? fixture.defaultInteractionSelector,
                  'focus-visible':
                    fixture.interactionSelectors['focus-visible'] ??
                    fixture.defaultInteractionSelector,
                })),
                observation,
                plan,
                side,
              };
            }),
          );
          const plan = planConditionProbes({
            hostDomain: fixture.sizeContract.host,
            viewportDomain: fixture.sizeContract.viewport,
            probes,
            remaining: shardController.capacity - probes.length,
            seeds,
            variant: variant.id,
          });
          conditionPlans.push(plan);
          variantProbes.push(...plan.scheduled);
          probes.push(...plan.scheduled);
          for (const [index, reasonCode] of plan.gaps.entries())
            findings.push({
              confirmed: false,
              id: `conditions:${variant.id}:${index}`,
              reasonCode,
              severity: 'review',
            });
        }
        if (options.bindingPlans && !planConditions && probeIndex === initialCount - 1) {
          const supplement = planSupplementalProbes({
            plans: rulePlans.filter((entry) => entry.variant === variant.id),
            evidence: ruleEvidence.filter((entry) => entry.variant === variant.id),
            probes,
            remaining: shardController.capacity - probes.length,
          });
          supplementalPlans.push({ ...supplement, variant: variant.id });
          variantProbes.push(...supplement.scheduled);
          probes.push(...supplement.scheduled);
          for (const [index, reasonCode] of supplement.gaps.entries())
            findings.push({
              confirmed: false,
              id: `supplement:${variant.id}:${index}`,
              reasonCode,
              severity: 'review',
            });
        }
        timing.planning = performance.now() - phaseStarted;
        shardController.completeProbe(probe.id);
      }
      shardController.closeShard();
      fixtureResults.push({
        aaStable: stable,
        comparisons: count,
        id: `${fixture.id}:${variant.id}`,
        nodeCount: Number.isFinite(nodes) ? nodes : 0,
        propertyReads: reads,
      });
      console.log(
        JSON.stringify({
          fixture: fixture.id,
          variant: variant.id,
          probes: count,
          durationMs: performance.now() - variantStarted,
        }),
      );
    }
    const probeShards = shardController.report(probes.map((probe) => probe.id));
    if (options.screenshots) {
      await writeJson(output, 'screenshots.json', {
        advisoryOnly: true,
        captures: screenshots,
        maxCaptures: 3,
        limitations: [
          'VIEWPORT_ONLY',
          'PIXEL_EQUALITY_DOES_NOT_OVERRIDE_STYLE_FAILURE',
          'UNSAMPLED_STATES_NOT_PROVEN',
        ],
      });
      artifactFiles.push('screenshots.json');
    }
    await writeJson(output, 'probe-shards.json', probeShards);
    artifactFiles.push('probe-shards.json');
    for (const [index, reasonCode] of probeShards.gaps.entries())
      findings.push({
        confirmed: false,
        id: `probe-shards:${index}`,
        reasonCode,
        severity: 'review',
      });
    const ruleCoverage = options.bindingPlans
      ? summarizeRuleCoverage(rulePlans, ruleEvidence)
      : undefined;
    const conditionCoverage = conditionPlans.length
      ? summarizeConditionCoverage(
          conditionPlans,
          ruleEvidence,
          results.filter((entry) => entry.aaStable).map((entry) => entry.probe.id),
        )
      : undefined;
    if (conditionCoverage) {
      await writeJson(output, 'condition-plan.json', conditionPlans);
      await writeJson(output, 'condition-coverage.json', conditionCoverage);
      artifactFiles.push('condition-plan.json', 'condition-coverage.json');
      for (const [index, reasonCode] of [
        ...conditionCoverage.limitations,
        ...(conditionCoverage.summary.missing ? ['CONDITION_PARTITION_KEYS_MISSING'] : []),
      ].entries())
        findings.push({
          confirmed: false,
          id: `condition-coverage:${index}`,
          reasonCode,
          severity: 'review',
        });
    }
    if (ruleCoverage) {
      await writeJson(output, 'supplemental-plan.json', supplementalPlans);
      await writeJson(output, 'rule-observations.json', ruleEvidence);
      await writeJson(output, 'rule-coverage.json', ruleCoverage);
      artifactFiles.push('rule-observations.json', 'rule-coverage.json', 'supplemental-plan.json');
      const reasons = [
        ...ruleCoverage.gaps,
        ...ruleCoverage.limitations,
        ...(ruleCoverage.summary.globallyUnmounted ? ['RULE_TARGET_UNMOUNTED'] : []),
        ...(ruleCoverage.summary.partialActivation ? ['RULE_TARGET_ACTIVATION_INCOMPLETE'] : []),
        ...(ruleCoverage.summary.unsupported ? ['RULE_SELECTOR_OR_CONDITION_UNSUPPORTED'] : []),
        ...(ruleCoverage.summary.inactiveOnly ? ['RULE_ACTIVATION_UNPROVEN'] : []),
      ];
      for (const [index, reasonCode] of [...new Set(reasons)].entries())
        findings.push({
          confirmed: false,
          id: `rule-coverage:${index}`,
          reasonCode,
          severity: 'review',
        });
    }
    const durationMs = performance.now() - started;
    if (probes.length > 256)
      findings.push({
        confirmed: false,
        id: 'fixture-total-probe-budget',
        reasonCode: 'FIXTURE_TOTAL_PROBE_BUDGET_EXCEEDED',
        severity: 'review',
      });
    if (durationMs > 30_000)
      findings.push({
        confirmed: false,
        id: 'fixture-total-budget',
        reasonCode: 'FIXTURE_TOTAL_BUDGET_EXCEEDED',
        severity: 'review',
      });
    const result = {
      conditionCoverage: conditionCoverage?.summary,
      conditionCoverageRef: conditionCoverage ? 'condition-coverage.json' : undefined,
      timing: results.reduce(
        (totals, entry) => {
          for (const [key, value] of Object.entries(entry.timing))
            totals[key] = (totals[key] ?? 0) + value;
          return totals;
        },
        {} as Record<string, number>,
      ),
      ruleCoverage: ruleCoverage?.summary,
      supplemental: {
        scheduled: supplementalPlans.reduce((sum, entry) => sum + entry.scheduled.length, 0),
        blocked: supplementalPlans.reduce((sum, entry) => sum + entry.blocked.length, 0),
        unresolved: supplementalPlans.reduce(
          (sum, entry) => sum + entry.requirements.filter((item) => item.reason).length,
          0,
        ),
      },
      browser: browserIdentity,
      probeShards: probeShards.summary,
      probeShardsRef: 'probe-shards.json',
      durationMs,
      errors: [...failures].filter((failure) => failure.startsWith('PAGE_ERROR')),
      findings: [
        ...findings,
        ...[...failures]
          .filter((failure) => !failure.startsWith('PAGE_ERROR'))
          .map((reasonCode, index) => ({
            confirmed: false,
            id: `resource:${index}`,
            reasonCode,
            severity: 'review' as const,
          })),
      ],
      fixture,
      fixtureResults,
      gateEligible: false,
      results,
      ruleCoverageRef: ruleCoverage ? 'rule-coverage.json' : undefined,
      schemaVersion: 1,
      provenance: options.provenance,
      unexecutedProbeIds: probeShards.unexecutedProbeIds,
    };
    await writeJson(output, 'component-run.json', result);
    artifactFiles.push('component-run.json');
    return { artifactFiles, result };
  } catch (error) {
    console.error(error);
    await writeJson(output, 'component-error.json', {
      ruleEvidence,
      probeShards: shardController.report(probes.map((probe) => probe.id)),
      conditionPlans,
      supplementalPlans,
      rulePlans,
      artifactFiles,
      failures: [...failures],
      findings,
      fixtureResults,
      message: error instanceof Error ? error.message : String(error),
      results,
      status: 'ERROR',
      unexecutedProbeIds: probes
        .filter((probe) => !results.some((result) => result.probe.id === probe.id))
        .map((probe) => probe.id),
    });
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
};
