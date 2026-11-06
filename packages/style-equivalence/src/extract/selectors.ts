import selectorParser from 'postcss-selector-parser';

import type { StyleRule } from './types';

export type SelectorFlag = 'CROSS_COMPONENT' | 'INNER_TARGET';

interface Sibling {
  prev: () => Sibling | undefined;
  type: string;
}

interface Lineage {
  parent?: { parent?: { type: string; value?: string } };
}

interface Analysis {
  classes: Array<{ global: boolean; name: string }>;
  innerType: boolean;
}

const analyze = (selector: string): Analysis | undefined => {
  const result: Analysis = { classes: [], innerType: false };
  try {
    selectorParser((root) => {
      root.walkClasses((node) => {
        const grandparent = (node as unknown as Lineage).parent?.parent;
        const global = grandparent?.type === 'pseudo' && grandparent.value === ':global';
        result.classes.push({ global, name: node.value });
      });
      root.walkTags((node) => {
        let cursor = (node as unknown as Sibling).prev();
        while (cursor && cursor.type !== 'combinator') cursor = cursor.prev();
        if (cursor) result.innerType = true;
      });
    }).processSync(selector);
  } catch {
    return undefined;
  }
  return result;
};

export type LocalClass = (name: string, slots: string[]) => boolean;

export const classifyRules = (
  rules: StyleRule[],
  extraOwned: Record<string, string> = {},
  isLocal: LocalClass = () => false,
) => {
  const flags = new Map<string, Set<SelectorFlag>>();
  const add = (slot: string, flag: SelectorFlag) =>
    flags.set(slot, (flags.get(slot) ?? new Set()).add(flag));
  for (const rule of rules) {
    const owned = { ...rule.owned, ...extraOwned };
    const analysis = analyze(rule.selector);
    if (!analysis) continue;
    const ownedSlots = analysis.classes
      .filter((item) => !item.global && owned[item.name])
      .map((item) => owned[item.name]);
    if (!ownedSlots.length) continue;
    const foreign = analysis.classes.some(
      (item) => item.global || (!owned[item.name] && !isLocal(item.name, ownedSlots)),
    );
    for (const slot of new Set(ownedSlots)) {
      if (foreign) add(slot, 'CROSS_COMPONENT');
      if (analysis.innerType) add(slot, 'INNER_TARGET');
    }
  }
  return flags;
};

export const foreignClassNames = (
  rules: StyleRule[],
  extraOwned: Record<string, string> = {},
  isLocal: LocalClass = () => false,
) => {
  const names = new Set<string>();
  for (const rule of rules) {
    const owned = { ...rule.owned, ...extraOwned };
    const analysis = analyze(rule.selector);
    const ownedSlots =
      analysis?.classes
        .filter((item) => !item.global && owned[item.name])
        .map((item) => owned[item.name]) ?? [];
    if (!ownedSlots.length) continue;
    for (const item of analysis!.classes)
      if (!item.global && !owned[item.name] && !isLocal(item.name, ownedSlots))
        names.add(item.name);
  }
  return names;
};

export const classNamesIn = (selector: string) =>
  (analyze(selector)?.classes ?? []).filter((item) => !item.global).map((item) => item.name);

export const targetsInnerTag = (selector: string) => analyze(selector)?.innerType ?? true;
