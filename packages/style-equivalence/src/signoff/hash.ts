import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { FileExtraction, LiteralValue, StyleBinding } from '../extract';
import { elementsOf } from '../plan/descendants';
import { chainOf, type PlanCase, type Side } from '../plan/planFile';
import { declarationText, resolveSlot } from '../source/declarations';

export interface HashedElement {
  attributes?: Record<string, string>;
  bindings: StyleBinding[];
  literalProps: Record<string, LiteralValue>;
  slots: string[];
  tag: string;
}

export interface CaseHashInput {
  counterpart?: Partial<Record<Side, string>>;
  declarations: Partial<Record<Side, Record<string, string>>>;
  elements: Partial<Record<Side, HashedElement[]>>;
  outcome?: string[];
  plan?: Pick<PlanCase, 'combos' | 'flags' | 'forward' | 'inner' | 'variables'>;
  verifierMajor: string;
}

export interface OutcomeCause {
  after?: string;
  before?: string;
  key: string;
  property: string;
}

const sortKeys = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      )
    : value;

export const contentHash = (input: CaseHashInput) =>
  createHash('sha256').update(JSON.stringify(input, sortKeys)).digest('hex');

export interface CollectHashInput {
  aliases: Record<string, string>;
  elementIds?: Partial<Record<Side, string>>;
  extractions: Partial<Record<Side, FileExtraction>>;
  outcome?: OutcomeCause[];
  plan?: PlanCase;
  roots: Record<Side, string>;
  sources: Partial<Record<Side, string>>;
  verifierVersion: string;
}

export const collectCaseHashInput = (input: CollectHashInput): CaseHashInput => {
  const result: CaseHashInput = {
    declarations: {},
    elements: {},
    outcome: input.outcome
      ?.map((cause) =>
        [cause.key, cause.property, cause.before ?? '', cause.after ?? ''].join('\u0000'),
      )
      .sort(),
    plan: input.plan && {
      combos: input.plan.combos,
      flags: input.plan.flags,
      forward: input.plan.forward,
      inner: input.plan.inner,
      variables: input.plan.variables,
    },
    verifierMajor: input.verifierVersion.split('.')[0],
  };
  for (const side of ['base', 'head'] as const) {
    const extraction = input.extractions[side];
    const source = input.sources[side];
    const id = input.elementIds?.[side] ?? input.plan?.elementIds[side];
    if (!extraction || !source || !id) continue;
    const byId = new Map(elementsOf(extraction).map((element) => [element.id, element]));
    const element = byId.get(id);
    if (!element) continue;
    const chain = chainOf(element, byId, input.plan?.chainOmit?.[side]);
    result.elements[side] = chain.map(({ attributes, bindings, literalProps, slots, tag }) => ({
      ...(attributes ? { attributes } : {}),
      bindings,
      literalProps,
      slots,
      tag,
    }));
    const code = readFileSync(path.join(input.roots[side], source), 'utf8');
    const slots = [...new Set(chain.flatMap((item) => item.slots))].sort();
    result.declarations[side] = Object.fromEntries(
      slots.map((slot) => {
        const sites = resolveSlot(input.roots[side], source, code, slot, input.aliases);
        return [slot, sites.length ? sites.map(declarationText).join('\n') : `UNRESOLVED:${slot}`];
      }),
    );
  }
  return result;
};

export const collectFileHashInput = (
  input: Pick<CollectHashInput, 'roots' | 'sources' | 'verifierVersion'>,
): CaseHashInput => ({
  declarations: Object.fromEntries(
    (['base', 'head'] as const).flatMap((side) => {
      const source = input.sources[side];
      return source
        ? [[side, { [source]: readFileSync(path.join(input.roots[side], source), 'utf8') }]]
        : [];
    }),
  ),
  elements: {},
  verifierMajor: input.verifierVersion.split('.')[0],
});
