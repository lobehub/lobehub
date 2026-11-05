import type { FileExtraction, StyleElement, VariableKind } from '../extract';
import { mergeKinds, valueIdentifiers } from '../extract/identifiers';
import { type Combo, combosFor, DOMAIN_COMBO_LIMIT } from './combos';
import { childCovered, elementsOf, parentCovered, replacedDescendants } from './descendants';
import type { InnerNode } from './inner';
import { bindKnobs, parseExpression } from './knobs';
import { movedStylesheets } from './moved';
import { alignElements } from './pair';
import {
  isIntrinsicTag,
  placementPreserved,
  sharedConditions,
  type SideProperties,
} from './placement';
import { runtimeStyleProbe, styleDropped } from './probes';
import { tableDomain } from './tables';

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
  probe?: boolean;
  values?: string[];
}

export interface PlanCase {
  combos: Combo[];
  elementIds: Record<Side, string>;
  evidence?: string[];
  file: string;
  flags: string[];
  inner?: Record<string, InnerNode[]>;
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
    base: new Map(elementsOf(base).map((e) => [e.id, e])),
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
  const replaced = replacedDescendants(base, head, pairs, unpairedHead);
  const replacedHead = new Set(replaced.map(([, right]) => right));
  unpairedHead.splice(0, unpairedHead.length, ...unpairedHead.filter((e) => !replacedHead.has(e)));
  pairs.push(...replaced);
  const rendered = new Set(pairs.map(([left]) => left.id));
  const covered = new Set(
    [...new Set(replaced.map(([left]) => left.parent!))].filter((id) =>
      parentCovered(byId.base.get(id)!, base, rendered),
    ),
  );
  const moved = movedStylesheets(base, head, pairs);

  const cases = pairs.map(([left, right]): PlanCase => {
    const chains = { base: chainOf(left, byId.base), head: chainOf(right, byId.head) };
    const flags = new Set<string>();
    const evidence: string[] = [];
    const isReplaced = replacedHead.has(right);
    const movedAt =
      chains.base.length === chains.head.length
        ? chains.base.flatMap((item, index) => {
            const proof = moved.get(item.id);
            return proof && proof.head === chains.head[index].id ? [{ index, proof }] : [];
          })
        : [];
    const movedItems = new Set(
      movedAt.flatMap(({ index }) => [chains.base[index], chains.head[index]]),
    );
    if (left.tag !== right.tag) flags.add('TAG_CHANGED');
    for (const item of [...chains.base, ...chains.head]) {
      if (!isIntrinsicTag(item.tag) && !layout.has(item.tag)) flags.add('PLACEMENT_SUBSTITUTED');
      if (item.bindings.some((binding) => !binding.spread && binding.prop !== 'className'))
        flags.add('PLACEMENT_NEUTRAL_PROP');
      const reached =
        chains.base.includes(item) &&
        (covered.has(item.id) ||
          (isReplaced && item.id === left.parent && childCovered(item, left, base.rules)));
      const inner = item.flags.includes('INNER_TARGET') && (reached || movedItems.has(item));
      if (inner && reached && !isReplaced && !evidence.includes('DESCENDANT_RENDERED'))
        evidence.push('DESCENDANT_RENDERED');
      item.flags.forEach((flag) => !(inner && flag === 'INNER_TARGET') && flags.add(flag));
    }
    if (isReplaced) evidence.push('DESCENDANT_REPLACED');
    const properties = { base: base.slotProperties, head: head.slotProperties };
    if (
      (flags.has('PLACEMENT_SUBSTITUTED') || flags.has('PLACEMENT_NEUTRAL_PROP')) &&
      placementPreserved(
        chains.base,
        chains.head.map((item, index) => {
          const placement = movedAt.find((entry) => entry.index === index)?.proof.placement;
          return placement
            ? { ...item, bindings: [{ ...item.bindings[0], expr: placement }] }
            : item;
        }),
        { layoutComponents: config.layoutComponents, properties },
      )
    ) {
      flags.delete('PLACEMENT_SUBSTITUTED');
      flags.delete('PLACEMENT_NEUTRAL_PROP');
      evidence.push('PLACEMENT_PRESERVED');
    }
    if (movedAt.length) evidence.push('STYLESHEET_MOVED');
    const inner = Object.fromEntries(
      movedAt
        .filter(({ proof }) => proof.nodes.length)
        .map(({ index, proof }) => [index, proof.nodes]),
    );
    const structural = flags.size > 0;
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
    const tables = { base: base.tables, head: head.tables };
    const found: Record<string, string[]> = {};
    const probes = new Set<string>();
    for (const variable of sorted) {
      if (!Object.values(variable.kinds).includes('unknown')) continue;
      const domain = tableDomain(variable.name, chains, tables);
      if (domain) found[variable.name] = domain;
      else if (runtimeStyleProbe(variable.name, chains)) probes.add(variable.name);
    }
    const model = (domains: Record<string, string[]>) => {
      const unknown = (variable: PlanVariable) =>
        !domains[variable.name] &&
        !probes.has(variable.name) &&
        Object.values(variable.kinds).includes('unknown');
      const knobs =
        sorted.some(unknown) && !structural ? conditionKnobs(chains, properties) : undefined;
      const modeled: PlanVariable[] = [];
      const added = new Set<string>();
      if (!knobs)
        for (const variable of sorted) {
          if (unknown(variable)) {
            added.add('VARIABLE_UNMODELED');
            continue;
          }
          if (probes.has(variable.name)) {
            modeled.push({ ...variable, probe: true });
            continue;
          }
          if (!variable.kinds.base || !variable.kinds.head) added.add('ASYMMETRIC_CONDITION');
          const values = domains[variable.name];
          modeled.push(values ? { ...variable, values } : variable);
        }
      const used = Object.fromEntries(
        modeled.flatMap((variable) => (variable.values ? [[variable.name, variable.values]] : [])),
      );
      const names = knobs ?? modeled.map((variable) => variable.name);
      return { added, knobs, modeled, used, ...combosFor(names, used) };
    };
    let modeling = model(found);
    if (Object.keys(modeling.used).length && modeling.combos.length > DOMAIN_COMBO_LIMIT)
      modeling = model({});
    const { combos, knobs, modeled, pairwise } = modeling;
    modeling.added.forEach((flag) => flags.add(flag));
    if (styleDropped(left, right, probes)) flags.add('RUNTIME_STYLE_DROPPED');
    if (knobs) evidence.push('CONDITION_KNOBS');
    if (Object.keys(modeling.used).length) evidence.push('TABLE_KEYS');
    if (modeled.some((variable) => variable.probe)) evidence.push('RUNTIME_STYLE_PROBED');
    if (pairwise) flags.add('COMBINATIONS_PAIRWISE');
    return {
      combos,
      elementIds: { base: left.id, head: right.id },
      ...(evidence.length ? { evidence } : {}),
      file,
      flags: [...flags].sort(),
      ...(Object.keys(inner).length ? { inner } : {}),
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
