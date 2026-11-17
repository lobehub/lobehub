import ts from 'typescript';

import type { StyleElement } from '../extract';
import { parseExpression } from './knobs';

type Sides<T> = Record<'base' | 'head', T>;

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const keysOf = (expr: string) => {
  const parsed = parseExpression(expr);
  const node = parsed && unwrap(parsed.expression);
  if (!node || !ts.isObjectLiteralExpression(node)) return '';
  return node.properties
    .map((property) => property.name?.getText() ?? '…')
    .sort()
    .join(',');
};

const signatureOf = (element: StyleElement | undefined) =>
  (element?.bindings ?? [])
    .filter((binding) => !binding.spread && binding.prop !== 'className')
    .map(
      (binding) =>
        `${binding.prop === 'styles' ? 'classNames' : binding.prop}:${keysOf(binding.expansion ?? binding.expr)}`,
    )
    .sort()
    .join(';');

export const neutralOmitted = (chains: Sides<StyleElement[]>) => {
  const indices: number[] = [];
  const length = Math.max(chains.base.length, chains.head.length);
  for (let index = 0; index < length; index++) {
    const left = signatureOf(chains.base[index]);
    const right = signatureOf(chains.head[index]);
    if ((left || right) && (left !== right || chains.base.length !== chains.head.length))
      indices.push(index);
  }
  return indices;
};
