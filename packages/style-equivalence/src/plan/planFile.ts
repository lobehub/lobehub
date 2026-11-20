import type {
  FileExtraction,
  LiteralValue,
  RealComponent,
  StyleElement,
  VariableKind,
  VariableUse,
} from '../extract';
import { mergeKinds, valueIdentifiers } from '../extract/identifiers';
import { type Combo, combosFor, DOMAIN_COMBO_LIMIT } from './combos';
import {
  childCovered,
  childrenLearned,
  elementsOf,
  parentCovered,
  replacedDescendants,
} from './descendants';
import {
  forwardedDescendants,
  forwardedInside,
  type ForwardPlan,
  partlyForwarded,
} from './forwarded';
import { INLINE_MASK, sharedInlineStyles, type SharedStyle } from './inlineStyle';
import type { InnerNode } from './inner';
import { keptEmotionRules } from './kept';
import { bindKnobs, parseExpression } from './knobs';
import { movedStylesheets } from './moved';
import { neutralOmitted } from './neutral';
import { alignElements } from './pair';
import {
  isIntrinsicTag,
  placementPreserved,
  sharedConditions,
  type SideProperties,
} from './placement';
import { runtimeStyleProbe, styleDropped } from './probes';
import { reachableCombos } from './reachable';
import { realItemsOf, rendersReal, sampleTargets, standInsOf } from './real';
import { type ShapeBook, shapeOf } from './shapes';
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
  chainOmit?: Partial<Record<Side, string[]>>;
  combos: Combo[];
  elementIds: Record<Side, string>;
  evidence?: string[];
  file: string;
  flags: string[];
  forward?: ForwardPlan;
  forwardedParam?: string;
  inlineMasks?: Partial<Record<Side, Array<{ index: number; style: string }>>>;
  inlineStyles?: Partial<Record<Side, Array<{ binding: number; index: number; without: string }>>>;
  inner?: Record<string, InnerNode[]>;
  key: string;
  knobs?: string[];
  neutralOmitted?: number[];
  realElements?: Record<Side, string[]>;
  realLeaf?: true;
  samples?: InnerNode[];
  standIns?: Partial<Record<Side, string[]>>;
  variables: PlanVariable[];
}

export interface FilePlan {
  cases: PlanCase[];
  file: string;
  gaps: string[];
  standIns?: Record<string, string[]>;
  unpaired: Array<{ counterpart?: UnpairedCounterpart; elementId: string; side: Side }>;
}

export interface UnpairedCounterpart {
  ancestors: string[];
  inlineStyle?: string;
  literalProps: Record<string, LiteralValue>;
  props?: string;
  real?: true;
  tag: string;
  variables: VariableUse[];
}

export interface PlanConfig {
  layoutComponents: string[];
  realComponents?: Record<string, RealComponent>;
  shapes?: ShapeBook;
}

const declarationFree = (element: StyleElement) =>
  !element.slots.length && !element.forwardedParam && !element.forwards?.length;

export const chainOf = (
  element: StyleElement,
  byId: Map<string, StyleElement>,
  omit?: readonly string[],
) => {
  const chain: StyleElement[] = [];
  let current: StyleElement | undefined = element;
  while (current) {
    if (current === element || !omit?.includes(current.id)) chain.unshift(current);
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

const alignedProofs = <T extends { head: string }>(
  proofs: Map<string, T>,
  chains: Record<Side, StyleElement[]>,
) =>
  chains.base.length === chains.head.length
    ? chains.base.flatMap((item, index) => {
        const proof = proofs.get(item.id);
        return proof && proof.head === chains.head[index].id ? [{ index, proof }] : [];
      })
    : [];

const PACKAGE_STYLESHEET = /^STYLESHEET_UNREADABLE:(@\w[\w.-]*\/)?\w[\w.-]*\//;

const fileGaps = (base: string[], head: string[]) =>
  [...new Set([...base, ...head])].filter(
    (gap) => !(PACKAGE_STYLESHEET.test(gap) && base.includes(gap) && head.includes(gap)),
  );

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
  const { learned, replaced, wrapped } = replacedDescendants(
    base,
    head,
    pairs,
    unpairedHead,
    config.shapes,
  );
  const replacedHead = new Set(replaced.map(([, right]) => right));
  unpairedHead.splice(
    0,
    unpairedHead.length,
    ...unpairedHead.filter((e) => !replacedHead.has(e) && !wrapped.has(e)),
  );
  pairs.push(...replaced);
  const forwarded = forwardedDescendants(base, head, pairs, unpairedHead, config.realComponents);
  const forwardOf = new Map(forwarded.map((entry) => [entry.pair[1], entry.forward]));
  const partial = new Map(
    forwarded.map((entry) => [entry.parent.id, partlyForwarded(entry.parent, entry.tag, layout)]),
  );
  const inside = forwardedInside(base, head, pairs, unpairedHead);
  const paramOf = new Map(inside.map((entry) => [entry.pair[1], entry.param]));
  unpairedHead.splice(
    0,
    unpairedHead.length,
    ...unpairedHead.filter((e) => !forwardOf.has(e) && !paramOf.has(e)),
  );
  pairs.push(...forwarded.map((entry) => entry.pair), ...inside.map((entry) => entry.pair));
  const rendered = new Set(pairs.map(([left]) => left.id));
  const learnedParents = new Set(
    replaced.filter(([, right]) => learned.has(right)).map(([left]) => left.parent!),
  );
  const covered = new Set(
    [...new Set(replaced.map(([left]) => left.parent!))].filter(
      (id) =>
        parentCovered(byId.base.get(id)!, base, rendered, config.shapes) &&
        (!learnedParents.has(id) || childrenLearned(byId.base.get(id)!, base, config.shapes)),
    ),
  );
  const moved = movedStylesheets(base, head, pairs);
  const kept = keptEmotionRules(base, head, pairs);

  const omittable = {
    base: unpairedBase.filter(declarationFree).map((element) => element.id),
    head: unpairedHead.filter(declarationFree).map((element) => element.id),
  };
  const cases = pairs.map(([left, right]): PlanCase => {
    const chains = {
      base: chainOf(left, byId.base, omittable.base),
      head: chainOf(right, byId.head, omittable.head),
    };
    const chainOmit = Object.fromEntries(
      (['base', 'head'] as const).flatMap((side) => {
        const full = chainOf(side === 'base' ? left : right, byId[side]);
        const ids = full.filter((item) => !chains[side].includes(item)).map((item) => item.id);
        return ids.length ? [[side, ids]] : [];
      }),
    );
    const flags = new Set<string>();
    const evidence: string[] = [];
    const isReplaced = replacedHead.has(right);
    const forward = forwardOf.get(right);
    const param = paramOf.get(right);
    const resolved = new Set(forward ? [left, right] : []);
    const movedAt = alignedProofs(moved, chains);
    const keptAt = alignedProofs(kept, chains);
    const provenItems = new Set(
      [...movedAt, ...keptAt].flatMap(({ index }) => [chains.base[index], chains.head[index]]),
    );
    const keptWhole = new Set(
      keptAt
        .filter(({ proof }) => proof.exhaustive)
        .flatMap(({ index }) => [chains.base[index], chains.head[index]]),
    );
    if (left.tag !== (right.wraps ? byId.head.get(right.wraps)?.tag : right.tag))
      flags.add('TAG_CHANGED');
    for (const item of chains.head)
      for (const slot of item.slots)
        for (const key of head.unsupported?.[slot] ?? []) flags.add(`STYLEX_UNSUPPORTED:${key}`);
    const realItems = realItemsOf(chains, config.realComponents);
    const realElements = learned.has(right) ? { base: [left.id], head: [right.id] } : undefined;
    if (realElements) [left, right].forEach((item) => realItems.add(item));
    for (const item of [...chains.base, ...chains.head]) {
      const real = realItems.has(item) || resolved.has(item);
      if (!isIntrinsicTag(item.tag) && !layout.has(item.tag) && !real)
        flags.add('PLACEMENT_SUBSTITUTED');
      if (!real && item.bindings.some((binding) => !binding.spread && binding.prop !== 'className'))
        flags.add('PLACEMENT_NEUTRAL_PROP');
      const reached =
        chains.base.includes(item) &&
        (covered.has(item.id) ||
          (!!forward && item.id === left.parent) ||
          (isReplaced && item.id === left.parent && childCovered(item, left, base.rules)));
      const inner = item.flags.includes('INNER_TARGET') && (reached || provenItems.has(item));
      if (inner && reached && !isReplaced && !forward && !evidence.includes('DESCENDANT_RENDERED'))
        evidence.push('DESCENDANT_RENDERED');
      const cleared = (flag: string) =>
        (inner && flag === 'INNER_TARGET') || (keptWhole.has(item) && flag === 'CROSS_COMPONENT');
      item.flags.forEach((flag) => !cleared(flag) && flags.add(flag));
    }
    if (isReplaced) evidence.push('DESCENDANT_REPLACED');
    if (realElements) evidence.push('COMPONENT_SHAPE_LEARNED');
    if (forward) evidence.push('FORWARDED_RENDERED');
    if (param) evidence.push('FORWARDED_PROP_ABSENT');
    const partialFlag = partial.get(left.id);
    if (partialFlag && flags.has('INNER_TARGET')) flags.add(partialFlag);
    const properties = { base: base.slotProperties, head: head.slotProperties };
    if (
      (flags.has('PLACEMENT_SUBSTITUTED') || flags.has('PLACEMENT_NEUTRAL_PROP')) &&
      placementPreserved(
        chains.base,
        chains.head.map((item, index) => {
          const placement = [...movedAt, ...keptAt].find((entry) => entry.index === index)?.proof
            .placement;
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
    if (keptAt.length) evidence.push('EMOTION_RULE_KEPT');
    if (realItems.size) evidence.push('REAL_COMPONENT_RENDERED');
    const samples = realItems.size ? sampleTargets(chains, { base, head }) : [];
    const omitted = neutralOmitted(chains);
    const standIns = Object.fromEntries(
      (['base', 'head'] as const).flatMap((side) => {
        const tags = standInsOf(
          chains[side],
          (item) => realItems.has(item) || resolved.has(item),
          layout,
        );
        return tags.length ? [[side, tags]] : [];
      }),
    );
    const inner: Record<string, InnerNode[]> = {};
    for (const { index, proof } of [...movedAt, ...keptAt])
      if (proof.nodes.length) inner[index] = [...(inner[index] ?? []), ...proof.nodes];
    const structural = flags.size > 0;
    const shared = sharedInlineStyles(chains, {
      base: base.moduleNames,
      head: head.moduleNames,
    });
    const inlineMasks: NonNullable<PlanCase['inlineMasks']> = {};
    for (const [side, list] of Object.entries(shared) as Array<[Side, SharedStyle[]]>)
      for (const { index, mask } of list)
        if (mask)
          (inlineMasks[side === 'base' ? 'head' : 'base'] ??= []).push({ index, style: mask });
    const toggled = Object.values(shared).some((list) =>
      list.some((style) => style.mask && !style.certain),
    );
    const targetShared = Object.values(shared).some((list) =>
      list.some((style) => style.index === chains.base.length - 1),
    );
    const variables = new Map<string, PlanVariable>();
    for (const side of ['base', 'head'] as const)
      for (const [itemIndex, item] of chains[side].entries())
        for (const variable of item.variables) {
          if (PASS_THROUGH_VARIABLES.has(variable.name) || variable.name === param) continue;
          if (
            shared[side]?.some(
              (style) => style.index === itemIndex && style.names.includes(variable.name),
            )
          )
            continue;
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
    const { knobs, modeled, pairwise } = modeling;
    const reached = knobs ? modeling.combos : reachableCombos(modeling.combos, chains);
    const combos = toggled
      ? reached.flatMap((combo) => [
          { ...combo, [INLINE_MASK]: true },
          { ...combo, [INLINE_MASK]: false },
        ])
      : reached;
    if (reached.length < modeling.combos.length) evidence.push('COMBOS_UNREACHABLE_DROPPED');
    modeling.added.forEach((flag) => flags.add(flag));
    if (!targetShared && styleDropped(left, right, probes)) flags.add('RUNTIME_STYLE_DROPPED');
    if (knobs) evidence.push('CONDITION_KNOBS');
    if (Object.keys(modeling.used).length) evidence.push('TABLE_KEYS');
    if (modeled.some((variable) => variable.probe)) evidence.push('RUNTIME_STYLE_PROBED');
    if (pairwise) flags.add('COMBINATIONS_PAIRWISE');
    if (Object.values(shared).some((list) => list.some((style) => style.reordered)))
      flags.add('INLINE_STYLE_SPREAD_ORDER');
    return {
      combos,
      elementIds: { base: left.id, head: right.id },
      ...(evidence.length ? { evidence } : {}),
      file,
      flags: [...flags].sort(),
      ...(forward ? { forward } : {}),
      ...(param ? { forwardedParam: param } : {}),
      ...(Object.keys(inlineMasks).length ? { inlineMasks } : {}),
      ...(Object.keys(shared).length
        ? {
            inlineStyles: Object.fromEntries(
              Object.entries(shared).map(([side, list]) => [
                side,
                list.map(({ binding, index, without }) => ({ binding, index, without })),
              ]),
            ),
          }
        : {}),
      ...(Object.keys(chainOmit).length ? { chainOmit } : {}),
      ...(Object.keys(inner).length ? { inner } : {}),
      key: `${file}|${left.id}`,
      ...(knobs ? { knobs } : {}),
      ...(omitted.length ? { neutralOmitted: omitted } : {}),
      ...(realElements ? { realElements } : {}),
      ...(realElements && shapeOf(left, 'base', config.shapes)?.leaf
        ? { realLeaf: true as const }
        : {}),
      ...(samples.length ? { samples } : {}),
      ...(Object.keys(standIns).length ? { standIns } : {}),
      variables: modeled,
    };
  });

  const unpairedStandIns = Object.fromEntries(
    (['base', 'head'] as const).flatMap((side) =>
      (side === 'base' ? unpairedBase : unpairedHead).flatMap((element) => {
        const chain = chainOf(element, byId[side]);
        const tags = standInsOf(
          chain,
          (item, index) => rendersReal(item, index === chain.length - 1, config.realComponents),
          layout,
        );
        return tags.length ? [[`${side}:${element.id}`, tags]] : [];
      }),
    ),
  );
  return {
    cases,
    file,
    gaps: fileGaps(base.gaps, head.gaps),
    ...(Object.keys(unpairedStandIns).length ? { standIns: unpairedStandIns } : {}),
    unpaired: [
      ...unpairedBase.map((element) => ({ elementId: element.id, side: 'base' as const })),
      ...unpairedHead.map((element) => ({ elementId: element.id, side: 'head' as const })),
    ],
  };
};
