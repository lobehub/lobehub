import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import type { FileExtraction } from '../extract';
import type { Side } from '../plan/planFile';
import type { ScopeFile } from '../source/scope';
import type { CaseCategory } from '../verdict/categorize';
import {
  conditionMutations,
  declarationMutations,
  type Mutation,
  MUTATION_OPERATORS,
  type MutationOperator,
  stylesheetMutations,
} from './operators';

export type MutationSite =
  | { binding: number; kind: 'binding' }
  | { kind: 'import'; path: string; specifier: string }
  | { kind: 'source'; path: string };

export interface MutationCandidate {
  caseKey: string;
  file: string;
  mutation: Mutation;
  site: MutationSite;
}

export interface PlannableCase {
  category: CaseCategory;
  key: string;
  plan: { elementIds: Record<Side, string>; file: string };
}

export interface PlanMutationsInput {
  aliases: Record<string, string>;
  cases: PlannableCase[];
  count: number;
  extractions: Record<string, Record<Side, FileExtraction>>;
  headRoot: string;
  operators?: MutationOperator[];
  scope: ScopeFile[];
  seed: string;
}

export const OVERSAMPLE = 3;
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

const random = (seed: string) => {
  let state = [...seed].reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16_777_619),
    2_166_136_261,
  );
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2_246_822_507);
    state = Math.imul(state ^ (state >>> 13), 3_266_489_909);
    return ((state ^= state >>> 16) >>> 0) / 4_294_967_296;
  };
};

const shuffled = <T>(items: T[], seed: string) => {
  const next = random(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
};

const resolveSpecifier = (
  root: string,
  from: string,
  specifier: string,
  aliases: Record<string, string>,
) => {
  const alias = Object.entries(aliases).find(([prefix]) => specifier.startsWith(prefix));
  const base = specifier.startsWith('.')
    ? path.join(path.dirname(from), specifier)
    : alias
      ? alias[1] + specifier.slice(alias[0].length)
      : undefined;
  if (!base) return undefined;
  return EXTENSIONS.map((extension) => path.normalize(base + extension)).find((candidate) => {
    const absolute = path.join(root, candidate);
    return existsSync(absolute) && !absolute.endsWith(path.sep) && path.extname(candidate) !== '';
  });
};

interface ImportedName {
  imported: string;
  specifier: string;
}

const importsOf = (code: string) => {
  const sf = ts.createSourceFile(
    'source.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const named = new Map<string, ImportedName>();
  const sideEffects: string[] = [];
  const locals = new Set<string>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) {
        sideEffects.push(specifier);
        continue;
      }
      if (clause.name) named.set(clause.name.text, { imported: 'default', specifier });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          named.set(element.name.text, {
            imported: (element.propertyName ?? element.name).text,
            specifier,
          });
      continue;
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) locals.add(declaration.name.text);
  }
  return { locals, named, sideEffects };
};

const slotMutations = (
  input: PlanMutationsInput,
  source: string,
  code: string,
  slot: string,
): Array<{ mutation: Mutation; site: MutationSite }> => {
  const dot = slot.indexOf('.');
  const [symbol, member] = [slot.slice(0, dot), slot.slice(dot + 1)];
  const { locals, named, sideEffects } = importsOf(code);
  const read = (file: string) => readFileSync(path.join(input.headRoot, file), 'utf8');
  if (symbol === 'global')
    return sideEffects.flatMap((specifier) => {
      const file = resolveSpecifier(input.headRoot, source, specifier, input.aliases);
      if (!file?.endsWith('.css')) return [];
      return stylesheetMutations(read(file), member).map((mutation) => ({
        mutation,
        site: { kind: 'import' as const, path: file, specifier },
      }));
    });
  if (locals.has(symbol))
    return declarationMutations(code, symbol, member).map((mutation) => ({
      mutation,
      site: { kind: 'source' as const, path: source },
    }));
  const imported = named.get(symbol);
  if (!imported) return [];
  const file = resolveSpecifier(input.headRoot, source, imported.specifier, input.aliases);
  if (!file) return [];
  const site = { kind: 'import' as const, path: file, specifier: imported.specifier };
  const mutations = file.endsWith('.css')
    ? stylesheetMutations(read(file), member)
    : declarationMutations(read(file), imported.imported, member);
  return mutations.map((mutation) => ({ mutation, site }));
};

export const planMutations = (input: PlanMutationsInput): MutationCandidate[] => {
  const operators = input.operators ?? MUTATION_OPERATORS;
  const candidates: MutationCandidate[] = [];
  const equal = shuffled(
    input.cases.filter((entry) => entry.category === 'equal'),
    input.seed,
  );
  for (const entry of equal) {
    if (candidates.length >= input.count * OVERSAMPLE) break;
    const source = input.scope.find((item) => (item.head ?? item.base) === entry.plan.file)?.head;
    const extraction = input.extractions[entry.plan.file]?.head;
    const element = extraction?.elements.find((item) => item.id === entry.plan.elementIds.head);
    if (!source || !element) continue;
    const code = readFileSync(path.join(input.headRoot, source), 'utf8');
    const options = [
      ...element.slots.flatMap((slot) => slotMutations(input, source, code, slot)),
      ...element.bindings.flatMap((binding, index) =>
        element.variables.length
          ? conditionMutations(binding.expr).map((mutation) => ({
              mutation,
              site: { binding: index, kind: 'binding' as const },
            }))
          : [],
      ),
    ].filter((option) => operators.includes(option.mutation.operator));
    if (!options.length) continue;
    const preferred = operators[candidates.length % operators.length];
    const chosen =
      options.find((option) => option.mutation.operator === preferred) ??
      options.find(
        (option) => operators.indexOf(option.mutation.operator) > operators.indexOf(preferred),
      ) ??
      options[0];
    candidates.push({ caseKey: entry.key, file: entry.plan.file, ...chosen });
  }
  return candidates;
};
