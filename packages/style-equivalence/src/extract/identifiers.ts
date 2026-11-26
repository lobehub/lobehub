import ts from 'typescript';

import type { VariableKind } from './types';

export const isJsxNode = (node: ts.Node) =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);

const isTagName = (node: ts.Identifier) => {
  const parent = node.parent;
  return (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxSelfClosingElement(parent) ||
      ts.isJsxClosingElement(parent)) &&
    parent.tagName === node
  );
};

const isNameOnly = (node: ts.Identifier) => {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  )
    return true;
  if (ts.isJsxAttribute(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  return false;
};

export interface IdentifierOptions {
  includeTags?: boolean;
  skipJsx?: boolean;
}

export const valueIdentifierNodes = (root: ts.Node, options: IdentifierOptions = {}) => {
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (options.skipJsx && isJsxNode(node)) return;
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && !isNameOnly(node) && (options.includeTags || !isTagName(node)))
      found.push(node);
    if (ts.isShorthandPropertyAssignment(node)) found.push(node.name);
    ts.forEachChild(node, visit);
  };
  if (options.skipJsx && isJsxNode(root)) return found;
  visit(root);
  return found;
};

export const valueIdentifiers = (root: ts.Node, options: IdentifierOptions = {}) =>
  new Set(valueIdentifierNodes(root, options).map((node) => node.text));

const outerOf = (node: ts.Expression) => {
  let current: ts.Node = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
};

const isBooleanContext = (node: ts.Node): boolean => {
  const expression = outerOf(node as ts.Expression);
  const parent = expression.parent;
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
    return true;
  if (ts.isConditionalExpression(parent) && parent.condition === expression) return true;
  if (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(parent.operatorToken.kind)
  )
    return parent.left === expression || isBooleanContext(parent);
  return false;
};

const usageOf = (node: ts.Identifier): VariableKind => {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return 'call';
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  ) {
    let top: ts.Expression = parent;
    while (
      (ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent)) &&
      top.parent.expression === top
    )
      top = top.parent;
    return isBooleanContext(top) ? 'member' : 'unknown';
  }
  return isBooleanContext(node) ? 'boolean' : 'unknown';
};

export const mergeKinds = (kinds: VariableKind[]): VariableKind => {
  const unique = [...new Set(kinds)];
  return unique.length === 1 ? unique[0] : 'unknown';
};

export const usageKinds = (root: ts.Node, names: Set<string>) => {
  const kinds = new Map<string, VariableKind[]>();
  for (const node of valueIdentifierNodes(root, { skipJsx: true })) {
    if (!names.has(node.text)) continue;
    kinds.set(node.text, [...(kinds.get(node.text) ?? []), usageOf(node)]);
  }
  return kinds;
};

const bindingNames = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) =>
        ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
      );

export const declaredLocally = (node: ts.Identifier) => {
  for (let scope: ts.Node = node.parent; !ts.isSourceFile(scope); scope = scope.parent) {
    if (ts.isFunctionLike(scope))
      for (const parameter of scope.parameters)
        if (bindingNames(parameter.name).includes(node.text)) return true;
    if (ts.isBlock(scope))
      for (const statement of scope.statements)
        if (
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some((declaration) =>
            bindingNames(declaration.name).includes(node.text),
          )
        )
          return true;
  }
  return false;
};

export const literalText = (node: ts.Node) =>
  ts.isStringLiteralLike(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node)
    ? node.text
    : undefined;
