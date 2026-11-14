import type { FileExtraction, StyleElement, StyleRule } from '../extract';
import { targetsInnerTag } from '../extract/selectors';
import { parseSelectorList, type SelectorNode } from './selectorTree';
import { reachesShape, type ShapeBook, shapeOf, shapePaired, type ShapeStep } from './shapes';

type Step = ShapeStep;

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

const allSteps = (parent: StyleElement, rules: StyleRule[]) =>
  rulesOf(parent, rules).flatMap(({ rule, scopes }) => stepsOf(rule, scopes) ?? []);

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
  const tagOf = (element: StyleElement | undefined) =>
    element?.wraps ? headById.get(element.wraps)?.tag : element?.tag;
  const tagsOf = (ids: string[], byId: Map<string, StyleElement>) =>
    JSON.stringify(ids.map((id) => tagOf(byId.get(id))));
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
      counterpart.tag === tagOf(element) &&
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
  shapes?: ShapeBook,
) => {
  const lookup = counterparts(base, head, pairs);
  const replaced: Array<[StyleElement, StyleElement]> = [];
  const learned = new Set<StyleElement>();
  for (const element of unpairedHead) {
    const found = lookup(element);
    if (!found) continue;
    if (targets(found.parent, found.counterpart.tag, base.rules))
      replaced.push([found.counterpart, element]);
    else if (shapePaired(found.counterpart, element, allSteps(found.parent, base.rules), shapes)) {
      replaced.push([found.counterpart, element]);
      learned.add(element);
    }
  }
  const headById = new Map(elementsOf(head).map((element) => [element.id, element]));
  const usages = new Map<StyleElement, StyleElement[]>();
  for (const usage of head.plain ?? []) {
    const wrapped = usage.wraps ? headById.get(usage.wraps) : undefined;
    if (!wrapped) continue;
    usages.set(wrapped, [...(usages.get(wrapped) ?? []), usage]);
    const found = lookup(usage);
    const effective = { ...usage, bindings: wrapped.bindings, component: wrapped.component };
    if (
      found &&
      shapePaired(found.counterpart, effective, allSteps(found.parent, base.rules), shapes)
    ) {
      replaced.push([found.counterpart, usage]);
      learned.add(usage);
    }
  }
  const wrapped = new Set(
    [...usages]
      .filter(([, list]) => list.every((usage) => learned.has(usage)))
      .map(([item]) => item),
  );
  return { learned, replaced, wrapped };
};

const shapeReached = (child: StyleElement | undefined, step: Step, shapes?: ShapeBook) => {
  const shape = child && shapeOf(child, 'base', shapes);
  return !!shape && reachesShape(step, shape);
};

export const parentCovered = (
  parent: StyleElement,
  base: FileExtraction,
  rendered: Set<string>,
  shapes?: ShapeBook,
) => {
  const steps = innerSteps(parent, base.rules);
  if (!steps?.length) return false;
  const byId = new Map(elementsOf(base).map((element) => [element.id, element]));
  const children = (parent.children ?? []).map((id) => byId.get(id));
  return steps.every((step) => {
    const literal = children.filter((child) => child?.tag === step.tag);
    const learned = children.filter((child) => shapeReached(child, step, shapes));
    const direct = [...literal, ...learned];
    if (direct.some((child) => !rendered.has(child!.id))) return false;
    return step.child || (parent.subtreeTags?.[step.tag] ?? 0) === literal.length;
  });
};

export const childrenLearned = (
  parent: StyleElement,
  base: FileExtraction,
  shapes: ShapeBook | undefined,
) => {
  const byId = new Map(elementsOf(base).map((element) => [element.id, element]));
  const children = (parent.children ?? []).map((id) => byId.get(id));
  const deep = innerSteps(parent, base.rules)?.some((step) => !step.child) ?? true;
  return children.every(
    (child) =>
      !!child &&
      (/^[a-z]/.test(child.tag) || (!!child.component && !!shapeOf(child, 'base', shapes))) &&
      !(deep && child.subtreeComponents?.length),
  );
};

export const childCovered = (parent: StyleElement, child: StyleElement, rules: StyleRule[]) => {
  const steps = innerSteps(parent, rules);
  return (
    !!steps?.length && steps.every((step) => step.child || !(child.subtreeTags?.[step.tag] ?? 0))
  );
};
