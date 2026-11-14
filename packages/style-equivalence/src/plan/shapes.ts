import ts from 'typescript';

import type { ComponentImport, LiteralValue, StyleElement } from '../extract';

type Side = 'base' | 'head';

export interface ShapeTarget {
  path: number[];
  tag: string;
}

export interface ComponentShape {
  className?: ShapeTarget;
  leaf?: true;
  root: string;
  slots: Record<string, ShapeTarget>;
  tags: string[];
}

export type ShapeBook = Record<string, Partial<Record<Side, ComponentShape>>>;

export interface ShapeStep {
  child: boolean;
  tag: string;
}

const sorted = (value: Record<string, LiteralValue>) =>
  Object.entries(value).sort(([a], [b]) => a.localeCompare(b));

export const shapeKey = (component: ComponentImport, props: Record<string, LiteralValue>) =>
  JSON.stringify([component.source, component.imported, sorted(props)]);

export const shapeOf = (element: StyleElement, side: Side, shapes: ShapeBook | undefined) =>
  element.component
    ? shapes?.[shapeKey(element.component, element.literalProps)]?.[side]
    : undefined;

export const slotNames = (expr: string) => {
  const parsed = ts.createSourceFile('slots.ts', `(${expr});`, ts.ScriptTarget.Latest, true);
  const [statement] = parsed.statements;
  let value = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
  while (value && ts.isParenthesizedExpression(value)) value = value.expression;
  if (!value || !ts.isObjectLiteralExpression(value)) return undefined;
  const names: string[] = [];
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const { name } = property;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return undefined;
    names.push(name.text);
  }
  return names.length ? names : undefined;
};

export const requestedSlots = (element: StyleElement) =>
  element.bindings.flatMap((binding) =>
    binding.prop === 'classNames' ? (slotNames(binding.expr) ?? []) : [],
  );

const styledTargets = (element: StyleElement, shape: ComponentShape) => {
  const targets: ShapeTarget[] = [];
  for (const binding of element.bindings) {
    if (binding.spread || binding.prop === 'className') {
      if (!shape.className) return undefined;
      targets.push(shape.className);
      continue;
    }
    if (binding.prop !== 'classNames') return undefined;
    const names = slotNames(binding.expr);
    if (!names) return undefined;
    for (const name of names) {
      const target = shape.slots[name];
      if (!target) return undefined;
      targets.push(target);
    }
  }
  return targets.length ? targets : undefined;
};

const sameTexts = (left: StyleElement, right: StyleElement) =>
  JSON.stringify(left.propTexts ?? []) === JSON.stringify(right.propTexts ?? []);

export const reachesShape = (step: ShapeStep, shape: ComponentShape) =>
  step.tag !== '*' && (step.child ? shape.root === step.tag : shape.tags.includes(step.tag));

export const shapePaired = (
  counterpart: StyleElement,
  element: StyleElement,
  steps: ShapeStep[],
  shapes: ShapeBook | undefined,
) => {
  const base = shapeOf(counterpart, 'base', shapes);
  const head = shapeOf(element, 'head', shapes);
  if (!base || !head || base.root !== head.root || element.foreignSpread) return false;
  if (!!base.leaf !== !!head.leaf) return false;
  if (JSON.stringify(counterpart.component) !== JSON.stringify(element.component)) return false;
  if (!sameTexts(counterpart, element)) return false;
  const targets = styledTargets(element, head);
  return (
    !!targets &&
    targets.every((target) =>
      steps.some(
        (step) =>
          reachesShape(step, base) &&
          target.tag === step.tag &&
          (!step.child || target.path.length === 0),
      ),
    )
  );
};
