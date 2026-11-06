import type { FileExtraction, RealComponent, StyleElement } from '../extract';
import type { ForwardApplication, ForwardElement } from '../extract/forward';
import { counterparts, innerSteps } from './descendants';

export interface ForwardPlan {
  application: ForwardApplication;
  base: ForwardElement;
  head: ForwardElement;
  prop: string;
}

type Pair = [StyleElement, StyleElement];

export const renderedTag = (
  element: ForwardElement,
  real: Record<string, RealComponent> | undefined,
) => {
  if (!element.tagImport) return /^[a-z][\w-]*$/.test(element.tag) ? element.tag : undefined;
  const component = real?.[element.tagImport.imported];
  if (!component?.tag || component.source !== element.tagImport.source) return undefined;
  const value = element.attributes[component.tag.prop];
  if (value === undefined) return component.tag.default;
  return typeof value === 'string' ? value : undefined;
};

export const forwardedDescendants = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Pair[],
  unpairedHead: StyleElement[],
  real: Record<string, RealComponent> | undefined,
) => {
  const lookup = counterparts(base, head, pairs);
  const found: Array<{ forward: ForwardPlan; pair: Pair; parent: StyleElement; tag: string }> = [];
  for (const element of unpairedHead) {
    const [binding] = element.bindings;
    if (element.bindings.length !== 1 || binding.spread) continue;
    const target = element.forwards?.find((entry) => entry.prop === binding.prop)?.target;
    if (!target?.base) continue;
    const match = lookup(element);
    const tag = renderedTag(target, real);
    if (!match || !tag || renderedTag(target.base, real) !== tag) continue;
    const steps = innerSteps(match.parent, base.rules);
    const reaches = steps?.some((step) => !step.child && step.tag === tag);
    if (!reaches || steps!.some((step) => step.child && step.tag === tag)) continue;
    const { application, attributes, path, tag: targetTag, tagImport } = target;
    found.push({
      forward: {
        application,
        base: target.base,
        head: { attributes, path, tag: targetTag, ...(tagImport ? { tagImport } : {}) },
        prop: binding.prop,
      },
      pair: [match.counterpart, element],
      parent: match.parent,
      tag,
    });
  }
  return found;
};

export const forwardedInside = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Pair[],
  unpairedHead: StyleElement[],
) => {
  const lookup = counterparts(base, head, pairs);
  return unpairedHead.flatMap((element) => {
    const match = element.forwardedParam ? lookup(element) : undefined;
    return match
      ? [{ pair: [match.counterpart, element] as Pair, param: element.forwardedParam! }]
      : [];
  });
};

export const partlyForwarded = (parent: StyleElement, tag: string, layout: Set<string>) => {
  const components = (parent.subtreeComponents ?? []).filter((name) => !layout.has(name));
  return `INNER_TARGET_PARTLY_FORWARDED:${tag}|${components.join(',')}`;
};
