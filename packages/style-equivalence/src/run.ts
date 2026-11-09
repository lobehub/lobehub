import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { Browser } from '@playwright/test';

import { type CaseResult, confirmDifferences, createRunAnalyzer, mergeRetry } from './analyze/diff';
import { buildWithStubs } from './build/stubs';
import { calibrate, type CalibrationResult } from './calibration';
import { launchBrowser } from './capture/browser';
import { captureRun, conditionFromLabel } from './capture/runner';
import { serveDirectories } from './capture/staticServer';
import type { ProjectConfig } from './config';
import { createRunDir, writeEvidence } from './evidence/store';
import type { MutationOperator } from './mutation/operators';
import { planMutations } from './mutation/plan';
import { type MutationReport, runMutations } from './mutation/run';
import { synthesize, writeHost } from './pipeline/synthesize';
import type { FilePlan, PlanCase } from './plan/planFile';
import { resolveScope } from './source/scope';
import { prepareRevisions } from './source/worktrees';
import type { Verdict } from './verdict';
import { assembleVerdict } from './verdict/assemble';
import { type CaseCategory, categorizeCase } from './verdict/categorize';

const run = promisify(execFile);

export const VERIFIER_VERSION = '2.14.0';
export const DEFAULT_MUTATIONS = 10;

export interface RunOptions {
  base: string;
  browser?: Browser;
  calibrate?: boolean;
  configFile: string;
  head: string;
  keepWorktrees?: boolean;
  mutationOperators?: MutationOperator[];
  mutations?: number;
  pr?: PullRequestInfo;
  recordsDir: string;
  repo: string;
  restrictTo?: string[];
}

export interface PullRequestInfo {
  branch: string;
  number: number;
  title: string;
}

export interface CaseRecord {
  category: CaseCategory;
  key: string;
  plan: PlanCase;
  result: CaseResult;
}

export interface RunResult {
  base: string;
  calibration: CalibrationResult[];
  cases: CaseRecord[];
  comparisons: number;
  durationMs: number;
  files: string[];
  head: string;
  mutation: MutationReport;
  plans: FilePlan[];
  runDir: string;
  runId: string;
  unpaired: number;
  verdict: Verdict;
}

const resolveSha = async (repo: string, revision: string) =>
  (await run('git', ['-C', repo, 'rev-parse', '--verify', `${revision}^{commit}`])).stdout.trim();

export const loadConfig = async (configFile: string) =>
  (await import(pathToFileURL(configFile).href)).default as ProjectConfig;

export const runComparison = async (options: RunOptions): Promise<RunResult> => {
  const started = performance.now();
  const config = await loadConfig(options.configFile);
  const base = await resolveSha(options.repo, options.base);
  const head = await resolveSha(options.repo, options.head);
  const { runDir, runId } = await createRunDir(options.recordsDir, base, head);
  const revisions = await prepareRevisions({ base, head, repo: options.repo, runDir });
  const roots = { base: revisions.base.root, head: revisions.head.root };
  let browser = options.browser;
  const ownsBrowser = !browser;
  try {
    const { files: scope } = await resolveScope({
      aliases: config.aliases,
      base,
      head,
      repo: options.repo,
      restrictTo: options.restrictTo,
    });
    const synthesis = await synthesize(scope, roots, config);
    const configDir = path.dirname(options.configFile);
    const hosts = {
      base: await writeHost('base', roots.base, synthesis, scope, config, configDir),
      head: await writeHost('head', roots.head, synthesis, scope, config, configDir),
    };
    const dists = { base: path.join(runDir, 'dist-base'), head: path.join(runDir, 'dist-head') };
    await Promise.all(
      (['base', 'head'] as const).map((side) =>
        buildWithStubs(
          {
            configFile: options.configFile,
            hostDir: hosts[side].host,
            logFile: path.join(runDir, `build-${side}.log`),
            outDir: dists[side],
            root: roots[side],
          },
          hosts[side].written,
        ),
      ),
    );
    const server = await serveDirectories(runDir);
    browser ??= await launchBrowser();
    let capture;
    let comparisons = 0;
    let cases: CaseRecord[];
    let mutation: MutationReport;
    try {
      const analyzer = createRunAnalyzer();
      capture = await captureRun({
        browser,
        conditions: config.conditions,
        onCondition: (condition) => {
          comparisons += Object.keys(condition.head).length + (condition.identical?.length ?? 0);
          analyzer.add(condition);
        },
        urls: { base: `${server.url}/dist-base/`, head: `${server.url}/dist-head/` },
      });
      const session = browser;
      const retry = async (
        results: CaseResult[],
        conditionsOf: (result: CaseResult) => string[],
        merge: (original: CaseResult, retry: CaseResult, conditions: string[]) => CaseResult,
      ): Promise<CaseResult[]> => {
        const targets = results.filter((result) => conditionsOf(result).length);
        if (!targets.length) return results;
        const keys = encodeURIComponent(JSON.stringify(targets.map((result) => result.key)));
        const again = createRunAnalyzer();
        await captureRun({
          browser: session,
          conditions: config.conditions,
          onCondition: again.add,
          plan: [...new Set(targets.flatMap(conditionsOf))].map(conditionFromLabel),
          urls: {
            base: `${server.url}/dist-base/#cases=${keys}`,
            head: `${server.url}/dist-head/#cases=${keys}`,
          },
        });
        const retried = new Map(again.finish().map((result) => [result.key, result]));
        return results.map((result) => {
          const second = retried.get(result.key);
          const conditions = conditionsOf(result);
          return conditions.length && second ? merge(result, second, conditions) : result;
        });
      };
      const total = capture.conditions.length;
      let analyzed = await retry(
        analyzer.finish(capture.caseGaps),
        (result) => result.unstableConditions,
        mergeRetry,
      );
      analyzed = await retry(
        analyzed,
        (result) => (result.differingConditions.length < total ? result.differingConditions : []),
        confirmDifferences,
      );
      const results = new Map(analyzed.map((result) => [result.key, result]));
      cases = synthesis.plans.flatMap((plan) =>
        plan.cases.map((entry) => {
          const result =
            results.get(entry.key) ??
            ({
              comboDifferences: [],
              differingConditions: [],
              errors: ['CASE_NOT_CAPTURED'],
              gaps: [],
              key: entry.key,
              rootCauses: [],
              status: 'error',
              unstableConditions: [],
            } satisfies CaseResult);
          return { category: categorizeCase(entry, result), key: entry.key, plan: entry, result };
        }),
      );
      const count = options.mutations ?? DEFAULT_MUTATIONS;
      mutation = await runMutations({
        browser,
        candidates: count
          ? planMutations({
              aliases: config.aliases,
              cases,
              count,
              extractions: synthesis.extractions,
              headRoot: roots.head,
              operators: options.mutationOperators,
              scope,
              seed: runId,
            })
          : [],
        config,
        configDir,
        configFile: options.configFile,
        count,
        extractions: synthesis.extractions,
        headRoot: roots.head,
        plans: synthesis.plans,
        runDir,
        scope,
        serverUrl: server.url,
        states: capture.states ?? [],
        widths: capture.widths,
      });
    } finally {
      await server.close();
    }
    const calibration = await calibrate(
      { base, cases, head, repo: options.repo, runDir },
      options.calibrate === false ? undefined : config.calibration,
    );
    const { evidence, verdict } = await assembleVerdict({
      aliases: config.aliases,
      calibration,
      cases,
      extractions: synthesis.extractions,
      mutation,
      plans: synthesis.plans,
      pr: options.pr?.number,
      recordsDir: options.recordsDir,
      roots,
      scope,
      unparsedSelectors: capture.unparsedSelectors,
      verifierVersion: VERIFIER_VERSION,
    });
    const result: RunResult = {
      base,
      calibration,
      cases,
      comparisons,
      durationMs: Math.round(performance.now() - started),
      files: synthesis.plans.map((plan) => plan.file),
      head,
      mutation,
      plans: synthesis.plans,
      runDir,
      runId,
      unpaired: synthesis.plans.reduce((total, plan) => total + plan.unpaired.length, 0),
      verdict,
    };
    await writeEvidence(runDir, 'run.json', {
      base,
      conditionConfig: config.conditions,
      conditions: capture.conditions.map((condition) => condition.condition),
      containerRules: capture.containerRules,
      dependencyMode: revisions.dependencyMode,
      durationMs: result.durationMs,
      head,
      pageErrors: capture.pageErrors,
      ...(options.pr ? { pr: options.pr } : {}),
      repo: options.repo,
      runId,
      scope,
      states: capture.states,
      unparsedMedia: capture.unparsedMedia,
      unparsedSelectors: capture.unparsedSelectors,
      verifierVersion: VERIFIER_VERSION,
      widths: capture.widths,
    });
    await writeEvidence(runDir, 'plan.json', synthesis.plans);
    await writeEvidence(runDir, 'extractions.json', synthesis.extractions);
    await writeEvidence(runDir, 'mutation.json', mutation);
    await writeEvidence(runDir, 'calibration.json', calibration);
    await writeEvidence(runDir, 'verdict.json', verdict);
    await writeEvidence(runDir, 'evidence.json', evidence);
    await writeEvidence(runDir, 'results.json', { cases, comparisons, unpaired: result.unpaired });
    return result;
  } finally {
    if (ownsBrowser) await browser?.close();
    if (!options.keepWorktrees) await revisions.cleanup();
  }
};
