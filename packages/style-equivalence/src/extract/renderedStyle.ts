import ts from 'typescript';

import { declaredLocally, usageKinds, valueIdentifierNodes } from './identifiers';
import type { VariableKind } from './types';

const PACKAGE = /^(?![./]|@\/)/;

const hasCall = (node: ts.Node): boolean =>
  ts.isCallExpression(node) ||
  ts.isTaggedTemplateExpression(node) ||
  !!ts.forEachChild(node, hasCall);

export interface RenderedStyle {
  imports: string[];
  locals: string[];
  text: string;
}

export const renderedStyle = (
  expression: ts.Expression,
  importOf: Map<string, ts.ImportDeclaration>,
  globals: Set<string>,
): RenderedStyle | undefined => {
  if (ts.isIdentifier(expression) || hasCall(expression)) return undefined;
  const locals = new Set<string>();
  const imports = new Set<string>();
  for (const node of valueIdentifierNodes(expression, { skipJsx: true })) {
    if (globals.has(node.text)) continue;
    if (declaredLocally(node)) {
      locals.add(node.text);
      continue;
    }
    const specifier = importOf.get(node.text)?.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier) || !PACKAGE.test(specifier.text))
      return undefined;
    imports.add(node.text);
  }
  const kinds = usageKinds(expression, locals);
  if ([...locals].some((name) => (kinds.get(name) ?? []).some((kind) => kind !== 'boolean')))
    return undefined;
  return {
    imports: [...imports],
    locals: [...locals],
    text: expression.getText().replaceAll(/\s+/g, ' '),
  };
};

export const applyRenderedStyle = (
  style: RenderedStyle,
  require: (name: string) => boolean,
  names: Set<string>,
  kinds: Map<string, VariableKind[]>,
) => {
  for (const name of style.imports) require(name);
  for (const name of style.locals) {
    names.add(name);
    kinds.set(name, [...(kinds.get(name) ?? []), 'boolean']);
  }
};
