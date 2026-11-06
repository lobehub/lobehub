import type { FileExtraction, RealComponent, StyleElement } from '../extract';
import { hasTargets } from './inner';

type Sides<T> = Record<'base' | 'head', T>;

export const rendersReal = (
  element: StyleElement,
  last: boolean,
  real: Record<string, RealComponent> | undefined,
) => !!element.real && !!real?.[element.tag] && (last || !real[element.tag].leaf);

export const realItemsOf = (
  chains: Sides<StyleElement[]>,
  real: Record<string, RealComponent> | undefined,
) =>
  new Set(
    (['base', 'head'] as const).flatMap((side) =>
      chains[side].filter((item, index) =>
        rendersReal(item, index === chains[side].length - 1, real),
      ),
    ),
  );

export const sampleTargets = (
  chains: Sides<StyleElement[]>,
  extractions: Sides<FileExtraction>,
) => {
  const selectors: string[] = [];
  for (const side of ['base', 'head'] as const) {
    const slots = new Set(chains[side].flatMap((item) => item.slots));
    const { rules, slotConditions } = extractions[side];
    for (const rule of rules) if (rule.slot && slots.has(rule.slot)) selectors.push(rule.selector);
    for (const slot of slots) selectors.push(...(slotConditions?.[slot] ?? []));
  }
  return hasTargets(selectors);
};

export const standInsOf = (
  chain: StyleElement[],
  rendered: (item: StyleElement, index: number) => boolean,
  layout: Set<string>,
) =>
  chain
    .filter(
      (item, index) =>
        !/^[a-z][\w-]*$/.test(item.tag) && !layout.has(item.tag) && !rendered(item, index),
    )
    .map((item) => item.tag);
