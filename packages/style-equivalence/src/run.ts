import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import type { Browser } from '@playwright/test';

import { analyzeRun, type CaseResult } from './analyze/diff';
import { buildSide } from './build/viteBuild';
import { launchBrowser } from './capture/browser';
import { captureRun } from './capture/runner';
import { serveDirectories } from './capture/staticServer';
import type { ProjectConfig } from './config';
import { createRunDir, writeEvidence } from './evidence/store';
import { synthesize, writeHost } from './pipeline/synthesize';
import type { FilePlan, PlanCase } from './plan/planFile';
import { resolveScope } from './source/scope';
import { prepareRevisions } from './source/worktrees';
import { type CaseCategory, categorizeCase } from './verdict/categorize';

const run = promisify(execFile);

export const VERIFIER_VERSION = '1.0.0';

export interface RunOptions {
  base: string;
  browser?: Browser;
  configFile: string;
  head: string;
  keepWorktrees?: boolean;
  recordsDir: string;
  repo: string;
}

export interface CaseRecord {
  category: CaseCategory;
  key: string;
  plan: PlanCase;
  result: CaseResult;
}

export interface RunResult {
  base: string;
  cases: CaseRecord[];
  comparisons: number;
  durationMs: number;
  files: string[];
  head: string;
  plans: FilePlan[];
  runDir: string;
  runId: string;
  unpaired: number;
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
        buildSide({
          configFile: options.configFile,
          hostDir: hosts[side].host,
          logFile: path.join(runDir, `build-${side}.log`),
          outDir: dists[side],
          root: roots[side],
        }),
      ),
    );
    const server = await serveDirectories(runDir);
    browser ??= await launchBrowser();
    let capture;
    try {
      capture = await captureRun({
        browser,
        conditions: config.conditions,
        urls: { base: `${server.url}/dist-base/`, head: `${server.url}/dist-head/` },
      });
    } finally {
      await server.close();
    }
    const results = new Map(analyzeRun(capture).map((result) => [result.key, result]));
    const cases: CaseRecord[] = synthesis.plans.flatMap((plan) =>
      plan.cases.map((entry) => {
        const result =
          results.get(entry.key) ??
          ({
            comboDifferences: [],
            differingConditions: [],
            errors: ['CASE_NOT_CAPTURED'],
            key: entry.key,
            rootCauses: [],
            status: 'error',
            unstableConditions: [],
          } satisfies CaseResult);
        return { category: categorizeCase(entry, result), key: entry.key, plan: entry, result };
      }),
    );
    const comparisons = capture.conditions.reduce(
      (total, condition) => total + Object.keys(condition.head).length,
      0,
    );
    const result: RunResult = {
      base,
      cases,
      comparisons,
      durationMs: Math.round(performance.now() - started),
      files: synthesis.plans.map((plan) => plan.file),
      head,
      plans: synthesis.plans,
      runDir,
      runId,
      unpaired: synthesis.plans.reduce((total, plan) => total + plan.unpaired.length, 0),
    };
    await writeEvidence(runDir, 'run.json', {
      base,
      containerRules: capture.containerRules,
      dependencyMode: revisions.dependencyMode,
      durationMs: result.durationMs,
      head,
      pageErrors: capture.pageErrors,
      runId,
      scope,
      unparsedMedia: capture.unparsedMedia,
      verifierVersion: VERIFIER_VERSION,
      widths: capture.widths,
    });
    await writeEvidence(runDir, 'plan.json', synthesis.plans);
    await writeEvidence(runDir, 'extractions.json', synthesis.extractions);
    await writeEvidence(runDir, 'results.json', { cases, comparisons, unpaired: result.unpaired });
    return result;
  } finally {
    if (ownsBrowser) await browser?.close();
    if (!options.keepWorktrees) await revisions.cleanup();
  }
};
