import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProjectConfig } from '../config';
import { extractFile, type FileExtraction } from '../extract';
import { generateHost, HOST_HTML } from '../generate/host';
import { generateModule } from '../generate/module';
import { carriedClasses, globalRulesChanged } from '../plan/globalRules';
import { type FilePlan, planFile, type Side } from '../plan/planFile';
import { packageFile } from '../source/aliases';
import { resolveSpecifier } from '../source/declarations';
import type { ScopeFile } from '../source/scope';
import { fileFlags } from '../verdict/fileItems';
import { attachCounterparts } from './counterparts';
import { fileReader, flagUncheckedCallers, gitGrepWord } from './forwardCallers';
import { markUnchangedChains } from './unchanged';

export const HOST_DIR = '.style-equivalence-host';
export const RUNTIME = path.resolve(import.meta.dirname, '../generate/hostRuntime.tsx');

const empty = (file: string): FileExtraction => ({
  elements: [],
  file,
  gaps: [],
  outsideReferences: [],
  prelude: '',
  rules: [],
  styleSymbols: [],
});

export const moduleReader =
  (root: string, aliases: Record<string, string>) => (fromFile: string, specifier: string) => {
    const file = resolveSpecifier(root, fromFile, specifier, aliases);
    return file && /\.[cm]?[jt]sx?$/.test(file)
      ? readFileSync(path.join(root, file), 'utf8')
      : undefined;
  };

export const stylesheetReader =
  (root: string, aliases: Record<string, string> = {}) =>
  (fromFile: string, specifier: string) => {
    const local = resolveSpecifier(root, fromFile, specifier, aliases);
    const target = local ? path.join(root, local) : packageFile(root, fromFile, specifier);
    return target && existsSync(target) ? readFileSync(target, 'utf8') : undefined;
  };

export interface Synthesis {
  extractions: Record<string, Record<Side, FileExtraction>>;
  plans: FilePlan[];
}

export const synthesize = async (
  scope: ScopeFile[],
  roots: Record<Side, string>,
  config: ProjectConfig,
): Promise<Synthesis> => {
  const extractions: Synthesis['extractions'] = {};
  const plans: FilePlan[] = [];
  const planned: Array<{ file: string; pair: Record<Side, FileExtraction>; plan: FilePlan }> = [];
  for (const entry of scope) {
    const file = entry.head ?? entry.base!;
    const code: Partial<Record<Side, string>> = {};
    const read = async (side: Side) => {
      const source = entry[side];
      if (!source) return empty(file);
      code[side] = await readFile(path.join(roots[side], source), 'utf8');
      return extractFile(code[side], source, {
        adapters: config.adapters,
        layoutComponents: config.layoutComponents,
        readBaseModule: side === 'head' ? moduleReader(roots.base, config.aliases) : undefined,
        readModule: moduleReader(roots[side], config.aliases),
        readStylesheet: stylesheetReader(roots[side], config.aliases),
        realComponents: config.realComponents,
      });
    };
    const pair = { base: await read('base'), head: await read('head') };
    const plan = planFile(file, pair.base, pair.head, config);
    attachCounterparts(plan, { code, extractions: pair, real: config.realComponents });
    markUnchangedChains(plan, pair, {
      aliases: config.aliases,
      roots,
      sources: { base: entry.base, head: entry.head },
    });
    planned.push({ file, pair, plan });
  }
  const carried = carriedClasses(planned.flatMap(({ pair }) => [pair.base, pair.head]));
  for (const { file, pair, plan } of planned) {
    const global = globalRulesChanged(pair.base, pair.head, carried);
    if (global) plan.gaps.push(global);
    if (!plan.cases.length && !plan.unpaired.length && !fileFlags(plan, pair).length) continue;
    extractions[file] = pair;
    plans.push(plan);
  }
  await flagUncheckedCallers(plans, {
    extractions,
    grep: gitGrepWord(roots.head),
    read: fileReader(roots.head),
  });
  return { extractions, plans };
};

export const syntheticPath = (source: string) =>
  path.join(path.dirname(source), `__style_equivalence__${path.basename(source)}`);

export const writeHost = async (
  side: Side,
  root: string,
  synthesis: Synthesis,
  scope: ScopeFile[],
  config: ProjectConfig,
  configDir: string,
) => {
  const host = path.join(root, HOST_DIR);
  await rm(host, { force: true, recursive: true });
  await mkdir(host, { recursive: true });
  const modules: Array<{ file: string; specifier: string }> = [];
  const written: string[] = [];
  for (const plan of synthesis.plans) {
    const source = scope.find((entry) => (entry.head ?? entry.base) === plan.file)?.[side];
    if (!source || (!plan.cases.length && !plan.unpaired.length)) continue;
    const target = path.join(root, syntheticPath(source));
    await writeFile(
      target,
      generateModule(synthesis.extractions[plan.file][side], plan, side, config),
    );
    written.push(target);
    modules.push({ file: plan.file, specifier: target });
  }
  await writeFile(path.join(host, 'index.html'), HOST_HTML);
  await writeFile(path.join(host, 'plan.json'), JSON.stringify(synthesis.plans));
  await writeFile(
    path.join(host, 'entry.tsx'),
    generateHost({
      hostWrapper: path.resolve(configDir, config.hostWrapper),
      modules,
      runtime: RUNTIME,
      themeAttribute: config.conditions.themeAttribute,
    }),
  );
  return { host, written };
};
