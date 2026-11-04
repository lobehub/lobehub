import type { FileExtraction, StyleElement, VariableKind } from '../extract';
import { mergeKinds, valueIdentifiers } from '../extract/identifiers';
import { type Combo, combosFor } from './combos';
import { bindKnobs, parseExpression } from './knobs';
import { alignElements } from './pair';
import {
  isIntrinsicTag,
  placementPreserved,
  sharedConditions,
  type SideProperties,
} from './placement';

export { isIntrinsicTag } from './placement';

export type Side = 'base' | 'head';

export const PASS_THROUGH_VARIABLES = new Set([
  'className',
  'classNames',
  'cx',
  'props',
  'style',
  'styles',
]);

export interface PlanVariable {
  kinds: Partial<Record<Side, VariableKind>>;
  name: string;
}

export interface PlanCase {
  combos: Combo[];
  elementIds: Record<Side, string>;
  evidence?: string[];
  file: string;
  flags: string[];
  key: string;
  knobs?: string[];
  variables: PlanVariable[];
}

export interface FilePlan {
  cases: PlanCase[];
  file: string;
  gaps: string[];
  unpaired: Array<{ elementId: string; side: Side }>;
}

export interface PlanConfig {
  layoutComponents: string[];
}

export const chainOf = (element: StyleElement, byId: Map<string, StyleElement>) => {
  const chain: StyleElement[] = [];
  let current: StyleElement | undefined = element;
  while (current) {
    chain.unshift(current);
    current = current.parent ? byId.get(current.parent) : undefined;
  }
  return chain;
};

const boundWithoutVariables = (chain: StyleElement[], knobs: string[]) =>
  chain.every((element) => {
    const names = new Set(
      element.variables
        .map((variable) => variable.name)
        .filter((name) => !PASS_THROUGH_VARIABLES.has(name)),
    );
    const before = new Set<string>();
    const unbound = element.bindings.every((binding) => {
      const original = parseExpression(binding.expr);
      const bound = bindKnobs(binding.expr, knobs);
      const parsed = bound === undefined ? undefined : parseExpression(bound);
      if (!original || !parsed) return false;
      valueIdentifiers(original.expression).forEach((name) => before.add(name));
      return [...valueIdentifiers(parsed.expression)].every((name) => !names.has(name));
    });
    return unbound && [...names].every((name) => before.has(name));
  });

const conditionKnobs = (chains: Record<Side, StyleElement[]>, properties: SideProperties) => {
  const knobs = sharedConditions(chains.base, chains.head, properties);
  return knobs &&
    boundWithoutVariables(chains.base, knobs) &&
    boundWithoutVariables(chains.head, knobs)
    ? knobs
    : undefined;
};

const groupByOwner = (elements: StyleElement[]) => {
  const owners = new Map<string, StyleElement[]>();
  for (const element of elements)
    owners.set(element.owner, [...(owners.get(element.owner) ?? []), element]);
  return owners;
};

export const planFile = (
  file: string,
  base: FileExtraction,
  head: FileExtraction,
  config: PlanConfig,
): FilePlan => {
  const layout = new Set(config.layoutComponents);
  const byId = {
    base: new Map(base.elements.map((e) => [e.id, e])),
    head: new Map(head.elements.map((e) => [e.id, e])),
  };
  const baseOwners = groupByOwner(base.elements);
  const headOwners = groupByOwner(head.elements);
  const pairs: Array<[StyleElement, StyleElement]> = [];
  const unpairedBase: StyleElement[] = [];
  const unpairedHead: StyleElement[] = [];
  for (const [owner, elements] of baseOwners) {
    const other = headOwners.get(owner);
    if (!other) {
      unpairedBase.push(...elements);
      continue;
    }
    const aligned = alignElements(elements, other);
    pairs.push(...aligned.pairs);
    unpairedBase.push(...aligned.unpairedBase);
    unpairedHead.push(...aligned.unpairedHead);
  }
  for (const [owner, elements] of headOwners)
    if (!baseOwners.has(owner)) unpairedHead.push(...elements);

  const cases = pairs.map(([left, right]): PlanCase => {
    const chains = { base: chainOf(left, byId.base), head: chainOf(right, byId.head) };
    const flags = new Set<string>([...left.flags, ...right.flags]);
    if (left.tag !== right.tag) flags.add('TAG_CHANGED');
    for (const item of [...chains.base, ...chains.head]) {
      if (!isIntrinsicTag(item.tag) && !layout.has(item.tag)) flags.add('PLACEMENT_SUBSTITUTED');
      if (item.bindings.some((binding) => !binding.spread && binding.prop !== 'className'))
        flags.add('PLACEMENT_NEUTRAL_PROP');
      item.flags.forEach((flag) => flags.add(flag));
    }
    const structural = flags.size > 0;
    const properties = { base: base.slotProperties, head: head.slotProperties };
    const evidence: string[] = [];
    if (
      (flags.has('PLACEMENT_SUBSTITUTED') || flags.has('PLACEMENT_NEUTRAL_PROP')) &&
      placementPreserved(chains.base, chains.head, {
        layoutComponents: config.layoutComponents,
        properties,
      })
    ) {
      flags.delete('PLACEMENT_SUBSTITUTED');
      flags.delete('PLACEMENT_NEUTRAL_PROP');
      evidence.push('PLACEMENT_PRESERVED');
    }
    const variables = new Map<string, PlanVariable>();
    for (const side of ['base', 'head'] as const)
      for (const item of chains[side])
        for (const variable of item.variables) {
          if (PASS_THROUGH_VARIABLES.has(variable.name)) continue;
          const entry = variables.get(variable.name) ?? { kinds: {}, name: variable.name };
          entry.kinds[side] = mergeKinds([entry.kinds[side] ?? variable.kind, variable.kind]);
          variables.set(variable.name, entry);
        }
    const sorted = [...variables.values()].sort((a, b) => a.name.localeCompare(b.name));
    const unmodeled = sorted.some((variable) => Object.values(variable.kinds).includes('unknown'));
    const knobs = unmodeled && !structural ? conditionKnobs(chains, properties) : undefined;
    const modeled: PlanVariable[] = [];
    if (knobs) evidence.push('CONDITION_KNOBS');
    else
      for (const variable of sorted) {
        if (Object.values(variable.kinds).includes('unknown')) {
          flags.add('VARIABLE_UNMODELED');
          continue;
        }
        if (!variable.kinds.base || !variable.kinds.head) flags.add('ASYMMETRIC_CONDITION');
        modeled.push(variable);
      }
    const { combos, pairwise } = combosFor(knobs ?? modeled.map((variable) => variable.name));
    if (pairwise) flags.add('COMBINATIONS_PAIRWISE');
    return {
      combos,
      elementIds: { base: left.id, head: right.id },
      ...(evidence.length ? { evidence } : {}),
      file,
      flags: [...flags].sort(),
      key: `${file}|${left.id}`,
      ...(knobs ? { knobs } : {}),
      variables: modeled,
    };
  });

  return {
    cases,
    file,
    gaps: [...new Set([...base.gaps, ...head.gaps])],
    unpaired: [
      ...unpairedBase.map((element) => ({ elementId: element.id, side: 'base' as const })),
      ...unpairedHead.map((element) => ({ elementId: element.id, side: 'head' as const })),
    ],
  };
};
