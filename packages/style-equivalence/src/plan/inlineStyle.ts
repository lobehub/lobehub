import ts from 'typescript';

import type { StyleElement } from '../extract';
import { valueIdentifiers } from '../extract/identifiers';

const compact = (text: string) => text.replaceAll(/\s+/g, '').replaceAll(/,(?=[)\]}])/g, '');

interface SxStyle {
  binding: number;
  certain?: boolean;
  mask?: string;
  names: string[];
  style: string;
  without: string;
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isTypeAssertionExpression(node)
    ? unwrap(node.expression)
    : node;

const ARITHMETIC = new Set([
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.SlashToken,
]);

const neverEmpty = (input: ts.Expression, constants: ReadonlySet<string>): boolean => {
  const node = unwrap(input);
  if (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  )
    return true;
  if (ts.isIdentifier(node)) return constants.has(node.text);
  if (ts.isPrefixUnaryExpression(node)) return neverEmpty(node.operand, constants);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    return !node.questionDotToken && neverEmpty(node.expression, constants);
  if (ts.isBinaryExpression(node))
    return (
      ARITHMETIC.has(node.operatorToken.kind) &&
      neverEmpty(node.left, constants) &&
      neverEmpty(node.right, constants)
    );
  if (ts.isConditionalExpression(node))
    return neverEmpty(node.whenTrue, constants) && neverEmpty(node.whenFalse, constants);
  return false;
};

const IDENTIFIER = /^[$A-Z_a-z][\w$]*$/;

export const INLINE_MASK = '__inlineStyle';

const maskOf = (input: ts.Expression, constants: ReadonlySet<string>) => {
  const node = unwrap(input);
  if (!ts.isObjectLiteralExpression(node) || !node.properties.length) return undefined;
  const keys: string[] = [];
  let certain = true;
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      keys.push(property.name.text);
      certain &&= neverEmpty(property.name, constants);
      continue;
    }
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    )
      return undefined;
    keys.push(property.name.text);
    certain &&= neverEmpty(property.initializer, constants);
  }
  const entries = keys.map((key) => `${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: 'unset'`);
  const mask = `{ ${entries.join(', ')} }`;
  return { certain, mask: certain ? mask : `__v.${INLINE_MASK} ? ${mask} : undefined` };
};

const sxStyleOf = (
  element: StyleElement,
  styleExpr: string,
  constants: ReadonlySet<string>,
): SxStyle | undefined => {
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
    const masked = maskOf(style, constants);
    const without = `${binding.expr.slice(0, start)}${masked?.mask ?? 'undefined'}${binding.expr.slice(end)}`;
    const kept = new Set(
      call.arguments
        .filter((_, index) => index !== position)
        .flatMap((argument) => [...valueIdentifiers(argument)]),
    );
    return {
      binding: index,
      ...masked,
      names: [...valueIdentifiers(style)].filter((name) => !kept.has(name)),
      style: compact(style.getText(source)),
      without,
    };
  }
  return undefined;
};

export interface SharedStyle {
  binding: number;
  certain?: boolean;
  index: number;
  mask?: string;
  names: string[];
  reordered: boolean;
  without: string;
}

export const sharedInlineStyles = (
  chains: Record<'base' | 'head', StyleElement[]>,
  moduleNames: Partial<Record<'base' | 'head', readonly string[]>> = {},
) => {
  const found: Partial<Record<'base' | 'head', SharedStyle[]>> = {};
  if (chains.base.length !== chains.head.length) return found;
  chains.base.forEach((left, index) => {
    const right = chains.head[index];
    for (const [side, own, other] of [
      ['head', right, left],
      ['base', left, right],
    ] as const) {
      if (!other.styleExpr || other.runtimeStyle || other.inlineStyle) continue;
      const variables = new Set([...own.variables, ...other.variables].map(({ name }) => name));
      const inBase = new Set(moduleNames.base ?? []);
      const constants = new Set(
        (moduleNames.head ?? []).filter((name) => inBase.has(name) && !variables.has(name)),
      );
      const sx = sxStyleOf(own, other.styleExpr, constants);
      if (!sx) continue;
      (found[side] ??= []).push({
        binding: sx.binding,
        ...(sx.mask ? { certain: sx.certain, mask: sx.mask } : {}),
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
