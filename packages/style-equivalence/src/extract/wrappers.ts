import ts from 'typescript';

import { propTextsOf } from './components';
import { componentOfStatement } from './forward';
import { ownerOf } from './owner';
import type { StyleElement } from './types';

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const returned = (body: ts.ConciseBody) => {
  if (!ts.isBlock(body)) return unwrap(body);
  const [statement, ...rest] = body.statements;
  return !rest.length && statement && ts.isReturnStatement(statement) && statement.expression
    ? unwrap(statement.expression)
    : undefined;
};

const forwardingRoot = (statement: ts.Statement, ast: ts.SourceFile) => {
  const fn = componentOfStatement(ast, statement);
  const [param, ...others] = fn?.parameters ?? [];
  if (!fn?.body || others.length || !param || !ts.isIdentifier(param.name)) return undefined;
  const root = returned(fn.body);
  if (!root || !ts.isJsxSelfClosingElement(root)) return undefined;
  const [first] = root.attributes.properties;
  return first &&
    ts.isJsxSpreadAttribute(first) &&
    ts.isIdentifier(first.expression) &&
    first.expression.text === param.name.text
    ? root
    : undefined;
};

export const localWrappers = (ast: ts.SourceFile, styled: Map<ts.Node, StyleElement>) => {
  const wrappers = new Map<string, StyleElement>();
  for (const statement of ast.statements) {
    const root = forwardingRoot(statement, ast);
    const element = root && styled.get(root);
    if (
      !root ||
      !element?.component ||
      element.parent ||
      Object.keys(element.literalProps).length ||
      element.propTexts?.length ||
      element.attributes ||
      element.inlineStyle ||
      root.attributes.properties.length !== element.bindings.length + 1
    )
      continue;
    wrappers.set(ownerOf(statement, ast), element);
  }
  return wrappers;
};

export const wrapperFields = (
  wrapped: StyleElement,
  opening: ts.JsxOpeningLikeElement,
  ast: ts.SourceFile,
) => {
  const propTexts = propTextsOf(opening, ast);
  return {
    ...(propTexts.length ? { propTexts } : {}),
    slots: wrapped.slots,
    wraps: wrapped.id,
  };
};
