import type { FileExtraction, StyleElement, StyleRule } from '../extract';
import { targetsInnerTag } from '../extract/selectors';
import { parseSelectorList, type SelectorNode } from './selectorTree';

interface Step {
  child: boolean;
  tag: string;
}

const sortedJson = (value: Record<string, unknown>) =>
  JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

export const elementsOf = (extraction: FileExtraction) => [
  ...extraction.elements,
  ...(extraction.plain ?? []),
];

const scopeNames = (rule: StyleRule, element: StyleElement) =>
  new Set(
    Object.entries(rule.owned)
      .filter(([, slot]) => element.slots.includes(slot))
      .map(([name]) => name),
  );

const stepOf = (nodes: SelectorNode[], scopes: Set<string>): Step | undefined => {
  const [scope, combinator, target] = nodes;
  if (
    nodes.length !== 3 ||
    scope.type !== 'class' ||
    !scopes.has(scope.value ?? '') ||
    combinator.type !== 'combinator' ||
    ![' ', '>'].includes(combinator.value?.trim() || ' ') ||
    (target.type !== 'tag' && target.type !== 'universal')
  )
    return undefined;
  return { child: combinator.value?.trim() === '>', tag: target.value ?? '*' };
};

const stepsOf = (rule: StyleRule, scopes: Set<string>): Step[] | undefined => {
  const steps = parseSelectorList(rule.selector)?.map((nodes) => stepOf(nodes, scopes));
  return steps?.every(Boolean) ? (steps as Step[]) : undefined;
};

const rulesOf = (element: StyleElement, rules: StyleRule[]) =>
  rules.flatMap((rule) => {
    const scopes = scopeNames(rule, element);
    return scopes.size ? [{ rule, scopes }] : [];
  });

const targets = (parent: StyleElement, tag: string, rules: StyleRule[]) =>
  rulesOf(parent, rules).some(({ rule, scopes }) =>
    stepsOf(rule, scopes)?.some((step) => step.tag === '*' || step.tag === tag),
  );

export const innerSteps = (parent: StyleElement, rules: StyleRule[]) => {
  const steps: Step[] = [];
  for (const { rule, scopes } of rulesOf(parent, rules)) {
    if (!targetsInnerTag(rule.selector)) continue;
    const parsed = stepsOf(rule, scopes);
    if (!parsed) return undefined;
    steps.push(...parsed.filter((step) => step.tag !== '*'));
  }
  return steps;
};

export const counterparts = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Array<[StyleElement, StyleElement]>,
) => {
  const baseById = new Map(elementsOf(base).map((element) => [element.id, element]));
  const headById = new Map(elementsOf(head).map((element) => [element.id, element]));
  const pairedParent = new Map(pairs.map(([left, right]) => [right.id, left]));
  const tagsOf = (ids: string[], byId: Map<string, StyleElement>) =>
    JSON.stringify(ids.map((id) => byId.get(id)?.tag));
  return (element: StyleElement) => {
    const parent = element.parent ? pairedParent.get(element.parent) : undefined;
    const headParent = element.parent ? headById.get(element.parent) : undefined;
    if (!parent || !headParent) return undefined;
    const baseChildren = parent.children ?? [];
    const headChildren = headParent.children ?? [];
    if (tagsOf(baseChildren, baseById) !== tagsOf(headChildren, headById)) return undefined;
    const counterpart = baseById.get(baseChildren[headChildren.indexOf(element.id)]);
    return counterpart &&
      !counterpart.bindings.length &&
      !counterpart.flags.length &&
      counterpart.tag === element.tag &&
      sortedJson(counterpart.literalProps) === sortedJson(element.literalProps) &&
      sortedJson(counterpart.attributes ?? {}) === sortedJson(element.attributes ?? {})
      ? { counterpart, parent }
      : undefined;
  };
};

export const replacedDescendants = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Array<[StyleElement, StyleElement]>,
  unpairedHead: StyleElement[],
) => {
  const lookup = counterparts(base, head, pairs);
  const replaced: Array<[StyleElement, StyleElement]> = [];
  for (const element of unpairedHead) {
    const found = lookup(element);
    if (found && targets(found.parent, found.counterpart.tag, base.rules))
      replaced.push([found.counterpart, element]);
  }
  return replaced;
};

export const parentCovered = (
  parent: StyleElement,
  base: FileExtraction,
  rendered: Set<string>,
) => {
  const steps = innerSteps(parent, base.rules);
  if (!steps?.length) return false;
  const byId = new Map(elementsOf(base).map((element) => [element.id, element]));
  const children = (parent.children ?? []).map((id) => byId.get(id));
  return steps.every((step) => {
    const direct = children.filter((child) => child?.tag === step.tag);
    if (direct.some((child) => !rendered.has(child!.id))) return false;
    return step.child || (parent.subtreeTags?.[step.tag] ?? 0) === direct.length;
  });
};

export const childCovered = (parent: StyleElement, child: StyleElement, rules: StyleRule[]) => {
  const steps = innerSteps(parent, rules);
  return (
    !!steps?.length && steps.every((step) => step.child || !(child.subtreeTags?.[step.tag] ?? 0))
  );
};
