import type { CaseResult } from '../analyze/diff';
import type { FileExtraction } from '../extract';
import type { FilePlan, PlanCase, Side } from '../plan/planFile';
import { collectCaseHashInput, contentHash } from '../signoff/hash';
import { readSignoffs } from '../signoff/store';
import type { ScopeFile } from '../source/scope';
import type { CaseCategory } from './categorize';
import { decideVerdict, type Verdict, type VerdictItem } from './index';

export interface AssembleInput {
  aliases: Record<string, string>;
  calibration: Array<{ status: string }>;
  cases: Array<{
    category: CaseCategory;
    key: string;
    plan: PlanCase;
    result: Pick<CaseResult, 'gaps'>;
  }>;
  extractions: Record<string, Record<Side, FileExtraction>>;
  mutation: { passed: boolean };
  plans: FilePlan[];
  roots: Record<Side, string>;
  scope: ScopeFile[];
  verifierVersion: string;
}

export const unpairedKey = (file: string, side: Side, elementId: string) =>
  `${file}|unpaired:${side}:${elementId}`;

export const assembleVerdict = async (input: AssembleInput) => {
  const sourcesOf = (file: string) => {
    const entry = input.scope.find((item) => (item.head ?? item.base) === file);
    return { base: entry?.base, head: entry?.head };
  };
  const hashFor = (file: string, extra: Partial<Parameters<typeof collectCaseHashInput>[0]>) =>
    contentHash(
      collectCaseHashInput({
        aliases: input.aliases,
        extractions: input.extractions[file] ?? {},
        roots: input.roots,
        sources: sourcesOf(file),
        verifierVersion: input.verifierVersion,
        ...extra,
      }),
    );
  const items: VerdictItem[] = [
    ...input.cases.map((entry) => ({
      category: entry.category,
      file: entry.plan.file,
      flags: [...entry.plan.flags, ...entry.result.gaps],
      hash: hashFor(entry.plan.file, { plan: entry.plan }),
      key: entry.key,
    })),
    ...input.plans.flatMap((plan) =>
      plan.unpaired.map(({ elementId, side }) => ({
        category: 'unpaired' as const,
        file: plan.file,
        flags: ['UNPAIRED'],
        hash: hashFor(plan.file, { elementIds: { [side]: elementId } }),
        key: unpairedKey(plan.file, side, elementId),
      })),
    ),
  ];
  const signoffs = await readSignoffs(
    input.roots.head,
    items.map((item) => item.file),
  );
  const verdict: Verdict = decideVerdict({
    calibration: input.calibration,
    items,
    mutation: input.mutation,
    signoffs,
  });
  return verdict;
};
