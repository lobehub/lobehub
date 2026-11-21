import ts from 'typescript';

import type { StyleElement } from '../extract';
import { valueIdentifierNodes, valueIdentifiers } from '../extract/identifiers';
import { parseExpression } from './knobs';
import { isIntrinsicTag } from './placement';

type Sides<T> = Record<'base' | 'head', T>;

const argumentUses = (element: StyleElement, name: string) => {
  let count = 0;
  for (const binding of element.bindings) {
    const parsed = parseExpression(binding.expr);
    if (!parsed) return undefined;
    for (const node of valueIdentifierNodes(parsed.expression)) {
      if (node.text !== name) continue;
      let outer: ts.Node = node;
      while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
      const { parent } = outer;
      if (!ts.isCallExpression(parent) || parent.expression === outer) return undefined;
      count += 1;
    }
  }
  return count;
};

const mentions = (element: StyleElement, name: string) =>
  element.variables.some((variable) => variable.name === name);

const anchoredAt = (anchor: StyleElement[], other: StyleElement[], name: string) => {
  const index = anchor.findIndex((element) => element.runtimeStyle === name);
  if (index < 0) return false;
  const target = anchor[index];
  return (
    isIntrinsicTag(target.tag) &&
    target.tag === other[index].tag &&
    other[index].runtimeStyle === undefined &&
    anchor.every(
      (element, at) => !mentions(element, name) && (at === index || element.runtimeStyle !== name),
    ) &&
    other.every(
      (element, at) => element.runtimeStyle !== name && (at === index || !mentions(element, name)),
    ) &&
    argumentUses(other[index], name) === 1
  );
};

export const runtimeStyleProbe = (name: string, chains: Sides<StyleElement[]>) =>
  chains.base.length === chains.head.length &&
  (anchoredAt(chains.base, chains.head, name) || anchoredAt(chains.head, chains.base, name));

export const styleDropped = (base: StyleElement, head: StyleElement, probed: Set<string>) => {
  if (Boolean(base.styleExpr) === Boolean(head.styleExpr)) return false;
  const [present, absent] = base.styleExpr ? [base, head] : [head, base];
  if (present.inlineStyle) return false;
  const parsed = parseExpression(present.styleExpr!);
  const names = parsed ? [...valueIdentifiers(parsed.expression)] : [];
  return !names.some((name) => probed.has(name) || mentions(absent, name));
};
