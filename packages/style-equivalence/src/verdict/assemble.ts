import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { CaseResult } from '../analyze/diff';
import type { FileExtraction } from '../extract';
import { elementsOf } from '../plan/descendants';
import type { FilePlan, PlanCase, Side } from '../plan/planFile';
import { readReviews, reviewScope } from '../review/store';
import {
  type CaseHashInput,
  collectCaseHashInput,
  collectFileHashInput,
  contentHash,
} from '../signoff/hash';
import { counterpartOf } from '../source/counterpart';
import type { ScopeFile } from '../source/scope';
import type { CaseCategory } from './categorize';
import { fileFlags, fileItemKey } from './fileItems';
import { decideVerdict, type Verdict, type VerdictItem } from './index';

export interface AssembleInput {
  aliases: Record<string, string>;
  calibration: Array<{ status: string }>;
  cases: Array<{
    category: CaseCategory;
    key: string;
    plan: PlanCase;
    result: Pick<CaseResult, 'gaps' | 'rootCauses'>;
  }>;
  extractions: Record<string, Record<Side, FileExtraction>>;
  mutation: { passed: boolean };
  plans: FilePlan[];
  pr?: number;
  recordsDir: string;
  roots: Record<Side, string>;
  scope: ScopeFile[];
  unparsedSelectors: string[];
  verifierVersion: string;
}

export const unpairedKey = (file: string, side: Side, elementId: string) =>
  `${file}|unpaired:${side}:${elementId}`;

export const assembleVerdict = async (input: AssembleInput) => {
  const sourcesOf = (file: string) => {
    const entry = input.scope.find((item) => (item.head ?? item.base) === file);
    return { base: entry?.base, head: entry?.head };
  };
  const evidence: Record<string, CaseHashInput> = {};
  const hashFor = (
    key: string,
    file: string,
    extra: Partial<Parameters<typeof collectCaseHashInput>[0]>,
  ) => {
    evidence[key] = collectCaseHashInput({
      aliases: input.aliases,
      extractions: input.extractions[file] ?? {},
      roots: input.roots,
      sources: sourcesOf(file),
      verifierVersion: input.verifierVersion,
      ...extra,
    });
    return contentHash(evidence[key]);
  };
  const items: VerdictItem[] = [
    ...input.cases.map((entry) => ({
      category: entry.category,
      file: entry.plan.file,
      flags: [...entry.plan.flags, ...entry.result.gaps],
      hash: hashFor(entry.key, entry.plan.file, {
        outcome: entry.category === 'difference' ? entry.result.rootCauses : undefined,
        plan: entry.plan,
      }),
      key: entry.key,
    })),
    ...input.plans.flatMap((plan) =>
      plan.unpaired.map(({ elementId, side }) => ({
        category: 'unpaired' as const,
        file: plan.file,
        flags: ['UNPAIRED'],
        hash: hashFor(unpairedKey(plan.file, side, elementId), plan.file, {
          elementIds: { [side]: elementId },
        }),
        key: unpairedKey(plan.file, side, elementId),
      })),
    ),
  ];
  const readSide = (side: Side, file: string | undefined) => {
    const absolute = file && path.join(input.roots[side], file);
    return absolute && existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
  };
  for (const plan of input.plans)
    for (const { elementId, side } of plan.unpaired) {
      const extraction = input.extractions[plan.file]?.[side];
      const element = extraction && elementsOf(extraction).find((item) => item.id === elementId);
      const other: Side = side === 'base' ? 'head' : 'base';
      const sources = sourcesOf(plan.file);
      const from = readSide(side, sources[side]);
      const to = readSide(other, sources[other]);
      if (!element || !from || !to) continue;
      const text = counterpartOf({
        expr: element.bindings[0]?.expr ?? '',
        from,
        owner: element.owner,
        tag: element.tag,
        to,
      });
      if (text) evidence[unpairedKey(plan.file, side, elementId)].counterpart = { [other]: text };
    }
  for (const plan of input.plans) {
    const flags = fileFlags(plan, input.extractions[plan.file] ?? {});
    if (!flags.length) continue;
    const key = fileItemKey(plan.file);
    evidence[key] = collectFileHashInput({
      roots: input.roots,
      sources: sourcesOf(plan.file),
      verifierVersion: input.verifierVersion,
    });
    items.push({
      category: 'needs-signoff',
      file: plan.file,
      flags,
      hash: contentHash(evidence[key]),
      key,
    });
  }
  const { passes: signoffs, reworks } = await readReviews(
    input.recordsDir,
    items.map((item) => item.file),
    reviewScope(items, input.pr),
  );
  const verdict: Verdict = decideVerdict({
    calibration: input.calibration,
    items,
    mutation: input.mutation,
    reworks,
    signoffs,
    unparsedSelectors: input.unparsedSelectors.length,
  });
  return { evidence, verdict };
};
