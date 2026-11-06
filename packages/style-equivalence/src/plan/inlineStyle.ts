import ts from 'typescript';

import type { StyleElement } from '../extract';
import { valueIdentifiers } from '../extract/identifiers';

const compact = (text: string) => text.replaceAll(/\s+/g, '').replaceAll(/,(?=[)\]}])/g, '');

interface SxStyle {
  binding: number;
  names: string[];
  style: string;
  without: string;
}

const sxStyleOf = (element: StyleElement, styleExpr: string): SxStyle | undefined => {
  for (const [index, binding] of element.bindings.entries()) {
    if (!binding.spread) continue;
    const source = ts.createSourceFile('t.ts', `(${binding.expr});`, ts.ScriptTarget.Latest, true);
    const [statement] = source.statements;
    let call = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
    while (call && ts.isParenthesizedExpression(call)) call = call.expression;
    if (!call || !ts.isCallExpression(call) || compact(call.expression.getText(source)) !== 'sx')
      continue;
    const position = call.arguments.findIndex(
      (argument, index) => index > 0 && compact(argument.getText(source)) === compact(styleExpr),
    );
    if (position < 0) continue;
    const style = call.arguments[position];
    const offset = 1;
    const start = style.getStart(source) - offset;
    const end = style.end - offset;
    const without = `${binding.expr.slice(0, start)}undefined${binding.expr.slice(end)}`;
    const kept = new Set(
      call.arguments
        .filter((_, index) => index !== position)
        .flatMap((argument) => [...valueIdentifiers(argument)]),
    );
    return {
      binding: index,
      names: [...valueIdentifiers(style)].filter((name) => !kept.has(name)),
      style: compact(style.getText(source)),
      without,
    };
  }
  return undefined;
};

export interface SharedStyle {
  binding: number;
  index: number;
  names: string[];
  reordered: boolean;
  without: string;
}

export const sharedInlineStyles = (chains: Record<'base' | 'head', StyleElement[]>) => {
  const found: Partial<Record<'base' | 'head', SharedStyle[]>> = {};
  if (chains.base.length !== chains.head.length) return found;
  chains.base.forEach((left, index) => {
    const right = chains.head[index];
    for (const [side, own, other] of [
      ['head', right, left],
      ['base', left, right],
    ] as const) {
      if (!other.styleExpr || other.runtimeStyle || other.inlineStyle) continue;
      const sx = sxStyleOf(own, other.styleExpr);
      if (!sx) continue;
      (found[side] ??= []).push({
        binding: sx.binding,
        index,
        names: sx.names,
        reordered:
          Boolean(own.foreignSpread) !== Boolean(other.foreignSpread) ||
          Boolean(own.spreadAfterStyle) !== Boolean(other.spreadAfterStyle),
        without: sx.without,
      });
    }
  });
  return found;
};
