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

const SLOT_GLOBALS = new Set(['undefined']);

const constInitializer = (ast: ts.SourceFile, name: string) => {
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        return declaration.initializer;
  }
  return undefined;
};

export const slotStylesOf = (
  name: string,
  tag: string,
  expression: ts.Expression,
  { importOf }: { importOf: Map<string, ts.ImportDeclaration> },
) => {
  if (name !== 'styles' || /^[a-z]/.test(tag)) return undefined;
  const object = ts.isIdentifier(expression)
    ? constInitializer(expression.getSourceFile(), expression.text)
    : expression;
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
  const slots = object.properties.every(
    (property) =>
      ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer),
  );
  const rendered = slots && renderedStyle(object, importOf, SLOT_GLOBALS);
  return rendered && !rendered.locals.length ? object.getText() : undefined;
};
