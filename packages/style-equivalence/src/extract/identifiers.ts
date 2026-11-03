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

const usageOf = (node: ts.Identifier): VariableKind => {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.expression === node) return 'call';
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  )
    return 'member';
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
    return 'boolean';
  if (ts.isConditionalExpression(parent) && parent.condition === node) return 'boolean';
  if (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(parent.operatorToken.kind)
  )
    return 'boolean';
  return 'unknown';
};

const RANK: Record<VariableKind, number> = { boolean: 1, call: 3, member: 2, unknown: 0 };

export const mergeKinds = (kinds: VariableKind[]): VariableKind => {
  const unique = [...new Set(kinds)];
  if (unique.includes('call') && unique.includes('member')) return 'unknown';
  if (unique.includes('unknown') && unique.length === 1) return 'unknown';
  return (
    unique.filter((kind) => kind !== 'unknown').sort((a, b) => RANK[b] - RANK[a])[0] ?? 'unknown'
  );
};

export const usageKinds = (root: ts.Node, names: Set<string>) => {
  const kinds = new Map<string, VariableKind[]>();
  for (const node of valueIdentifierNodes(root, { skipJsx: true })) {
    if (!names.has(node.text)) continue;
    kinds.set(node.text, [...(kinds.get(node.text) ?? []), usageOf(node)]);
  }
  return kinds;
};
