import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser } from '@playwright/test';

import { analyzeRun } from '../analyze/diff';
import { buildSide } from '../build/viteBuild';
import {
  captureSections,
  CONDITION_CONCURRENCY,
  type ConditionCapture,
  conditionLabel,
  inspectCaseGaps,
  type SectionSnapshots,
} from '../capture/runner';
import { compareSnapshots } from '../capture/snapshot';
import type { CaptureState } from '../capture/states';
import type { ProjectConfig } from '../config';
import { extractFile, type FileExtraction } from '../extract';
import { generateHost, HOST_HTML } from '../generate/host';
import { generateModule } from '../generate/module';
import { moduleReader, RUNTIME, stylesheetReader } from '../pipeline/synthesize';
import type { FilePlan } from '../plan/planFile';
import type { ScopeFile } from '../source/scope';
import { applyMutation, type MutationOperator } from './operators';
import { type MutantOutcome, mutantOutcome } from './outcome';
import type { MutationCandidate } from './plan';

export const MUTANT_HOST_DIR = '.style-equivalence-host-mutants';

export type { MutantOutcome } from './outcome';

export interface MutantResult {
  caseKey: string;
  description: string;
  detected: string[];
  errors: string[];
  expected: string[];
  gaps: string[];
  operator: MutationOperator;
  outcome: MutantOutcome;
  site: MutationCandidate['site'];
}

export interface MutationReport {
  caught: number;
  equivalent: number;
  error?: string;
  evaluated: number;
  mutants: MutantResult[];
  passed: boolean;
  requested: number;
}

export interface MutationContext {
  browser: Browser;
  candidates: MutationCandidate[];
  config: ProjectConfig;
  configDir: string;
  configFile: string;
  count: number;
  extractions: Record<string, { head: FileExtraction }>;
  headRoot: string;
  plans: FilePlan[];
  runDir: string;
  scope: ScopeFile[];
  serverUrl: string;
  states: CaptureState[];
  widths: number[];
}

const prefixed = (file: string, prefix: string) =>
  path.join(path.dirname(file), `${prefix}${path.basename(file)}`);

const specifierFor = (from: string, target: string) => {
  const relative = path.relative(path.dirname(from), target).replaceAll(path.sep, '/');
  const bare = relative.endsWith('.css') ? relative : relative.replace(/\.[cm]?[jt]sx?$/, '');
  return bare.startsWith('.') ? bare : `./${bare}`;
};

const replaceSpecifier = (prelude: string, from: string, to: string) =>
  prelude.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);

const writeMutant = async (
  context: MutationContext,
  candidate: MutationCandidate,
  index: number,
  plan: FilePlan,
) => {
  const source = context.scope.find(
    (entry) => (entry.head ?? entry.base) === candidate.file,
  )!.head!;
  const original = context.extractions[candidate.file].head;
  const caseEntry = plan.cases.find((entry) => entry.key === candidate.caseKey)!;
  const single: FilePlan = { ...plan, cases: [caseEntry], file: `${plan.file}#mutant${index}` };
  let extraction = original;
  const { site } = candidate;
  if (site.kind === 'binding')
    extraction = {
      ...original,
      elements: original.elements.map((element) =>
        element.id === caseEntry.elementIds.head
          ? {
              ...element,
              bindings: element.bindings.map((binding, position) =>
                position === site.binding
                  ? { ...binding, expr: applyMutation(binding.expr, candidate.mutation) }
                  : binding,
              ),
            }
          : element,
      ),
    };
  if (site.kind === 'source') {
    const code = await readFile(path.join(context.headRoot, source), 'utf8');
    extraction = extractFile(applyMutation(code, candidate.mutation), source, {
      adapters: context.config.adapters,
      layoutComponents: context.config.layoutComponents,
      readModule: moduleReader(context.headRoot, context.config.aliases),
      readStylesheet: stylesheetReader(context.headRoot, context.config.aliases),
      realComponents: context.config.realComponents,
    });
  }
  if (site.kind === 'import') {
    const copy = prefixed(site.path, `__style_equivalence_mutant_${index}__`);
    const code = await readFile(path.join(context.headRoot, site.path), 'utf8');
    await writeFile(path.join(context.headRoot, copy), applyMutation(code, candidate.mutation));
    extraction = {
      ...original,
      prelude: replaceSpecifier(original.prelude, site.specifier, specifierFor(source, copy)),
    };
  }
  const module = path.join(
    context.headRoot,
    prefixed(source, `__style_equivalence_mutant_case_${index}__`),
  );
  await writeFile(module, generateModule(extraction, single, 'head', context.config));
  return { module, single };
};

const label = (condition: string, section: string) =>
  `${condition}#${section.slice(section.lastIndexOf('|') + 1)}`;

const failedReport = (context: MutationContext, error: string): MutationReport => ({
  caught: 0,
  error,
  evaluated: 0,
  equivalent: 0,
  mutants: [],
  passed: false,
  requested: context.count,
});

export const runMutations = async (context: MutationContext): Promise<MutationReport> => {
  if (!context.candidates.length)
    return {
      caught: 0,
      evaluated: 0,
      equivalent: 0,
      mutants: [],
      passed: true,
      requested: context.count,
    };
  const host = path.join(context.headRoot, MUTANT_HOST_DIR);
  await rm(host, { force: true, recursive: true });
  await mkdir(host, { recursive: true });
  const written = await Promise.all(
    context.candidates.map((candidate, index) =>
      writeMutant(
        context,
        candidate,
        index,
        context.plans.find((plan) => plan.file === candidate.file)!,
      ),
    ),
  );
  await writeFile(path.join(host, 'index.html'), HOST_HTML);
  await writeFile(path.join(host, 'plan.json'), JSON.stringify(written.map((item) => item.single)));
  await writeFile(
    path.join(host, 'entry.tsx'),
    generateHost({
      hostWrapper: path.resolve(context.configDir, context.config.hostWrapper),
      modules: written.map((item) => ({ file: item.single.file, specifier: item.module })),
      runtime: RUNTIME,
      themeAttribute: context.config.conditions.themeAttribute,
    }),
  );
  try {
    await buildSide({
      configFile: context.configFile,
      hostDir: host,
      logFile: path.join(context.runDir, 'build-mutants.log'),
      outDir: path.join(context.runDir, 'dist-mutants'),
      root: context.headRoot,
    });
  } catch (error) {
    return failedReport(context, error instanceof Error ? error.message : String(error));
  }
  const keys = encodeURIComponent(JSON.stringify(context.candidates.map((item) => item.caseKey)));
  const urls = {
    base: `${context.serverUrl}/dist-base/#cases=${keys}`,
    head: `${context.serverUrl}/dist-head/#cases=${keys}`,
    mutant: `${context.serverUrl}/dist-mutants/`,
  };
  const pageErrors: string[] = [];
  const plan = context.config.conditions.themes.flatMap((theme) =>
    context.widths.flatMap((width) => context.states.map((state) => ({ state, theme, width }))),
  );
  const gaps = await inspectCaseGaps(
    context.browser,
    { base: urls.head, head: urls.mutant },
    plan[0],
    pageErrors,
  );
  const conditions: Array<ConditionCapture & { original: SectionSnapshots }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONDITION_CONCURRENCY }, async () => {
      for (let index = next++; index < plan.length; index = next++) {
        const options = plan[index];
        const { identical, snapshots } = await captureSections(
          context.browser,
          [urls.base, urls.head, urls.mutant],
          options,
          pageErrors,
        );
        const [base, head, mutant] = snapshots;
        conditions[index] = {
          base,
          baseAgain: base,
          condition: conditionLabel(options),
          head: mutant,
          identical,
          original: head,
          ...options,
        };
      }
    }),
  );
  const results = new Map(
    analyzeRun({
      conditions,
      containerRules: 0,
      pageErrors,
      unparsedMedia: 0,
      unparsedSelectors: [],
      widths: context.widths,
    }).map((result) => [result.key, result]),
  );
  const evaluated = context.candidates.map((candidate): MutantResult => {
    const expected = new Set<string>();
    for (const condition of conditions)
      for (const [section, mutant] of Object.entries(condition.head)) {
        if (!section.startsWith(`${candidate.caseKey}|`)) continue;
        const original = condition.original[section];
        if (!original || 'error' in original || 'error' in mutant) continue;
        if (compareSnapshots(original, mutant).some((item) => !item.diagnosticReason))
          expected.add(label(condition.condition, section));
      }
    const result = results.get(candidate.caseKey);
    const detected = new Set(
      result?.comboDifferences.map((item) => `${item.condition}#${item.combo}`) ?? [],
    );
    const errors = result ? result.errors : ['MUTANT_NOT_CAPTURED'];
    const caseGaps = gaps[candidate.caseKey] ?? [];
    const outcome = mutantOutcome({ detected, errors, expected, gaps: caseGaps });
    return {
      caseKey: candidate.caseKey,
      description: candidate.mutation.description,
      detected: [...detected].sort(),
      errors,
      expected: [...expected].sort(),
      gaps: caseGaps,
      operator: candidate.mutation.operator,
      outcome,
      site: candidate.site,
    };
  });
  const mutants: MutantResult[] = [];
  let counted = 0;
  for (const mutant of evaluated) {
    if (counted >= context.count) break;
    mutants.push(mutant);
    if (mutant.outcome !== 'equivalent') counted++;
  }
  const caught = mutants.filter((mutant) => mutant.outcome === 'caught').length;
  return {
    caught,
    evaluated: counted,
    equivalent: mutants.length - counted,
    mutants,
    passed: caught === counted,
    requested: context.count,
  };
};
