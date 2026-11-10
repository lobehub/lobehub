import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { FileExtraction } from '../extract';
import type { Side } from '../plan/planFile';
import { resolveSlot } from '../source/declarations';
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

const slotMutations = (
  input: PlanMutationsInput,
  source: string,
  code: string,
  slot: string,
): Array<{ mutation: Mutation; site: MutationSite }> =>
  resolveSlot(input.headRoot, source, code, slot, input.aliases).flatMap((site) =>
    (site.css
      ? stylesheetMutations(site.code, site.member)
      : declarationMutations(site.code, site.symbol, site.member)
    ).map((mutation) => ({
      mutation,
      site:
        site.kind === 'source'
          ? { kind: 'source' as const, path: site.path }
          : { kind: 'import' as const, path: site.path, specifier: site.specifier! },
    })),
  );

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
