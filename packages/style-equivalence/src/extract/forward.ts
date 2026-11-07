import ts from 'typescript';

import { literalOf } from './children';
import type { LiteralValue } from './types';

export type ForwardApplication = 'className' | 'props' | 'spread';

export interface ForwardElement {
  attributes: Record<string, LiteralValue>;
  path: number[];
  tag: string;
  tagImport?: { imported: string; source: string };
}

export interface ForwardTarget extends ForwardElement {
  application: ForwardApplication;
  base?: ForwardElement;
  baseReason?: string;
}

export interface ForwardResolution {
  prop: string;
  reason?: string;
  target?: ForwardTarget;
}

type ComponentFunction = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

const WRAPPERS = new Set(['forwardRef', 'memo']);
const STYLE_ATTRIBUTES = new Set(['class', 'className', 'style']);
const STYLEX = '@stylexjs/stylex';

const parse = (code: string) =>
  ts.createSourceFile('component.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const unwrap = (node: ts.Node): ts.Node =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const declarationOf = (sf: ts.SourceFile, name: string): ts.Node | undefined => {
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        return declaration.initializer;
  }
  return undefined;
};

const functionOf = (
  sf: ts.SourceFile,
  node: ts.Node | undefined,
  depth = 0,
): ComponentFunction | undefined => {
  if (!node || depth > 4) return undefined;
  const inner = unwrap(node);
  if (
    ts.isArrowFunction(inner) ||
    ts.isFunctionExpression(inner) ||
    ts.isFunctionDeclaration(inner)
  )
    return inner;
  if (ts.isIdentifier(inner)) return functionOf(sf, declarationOf(sf, inner.text), depth + 1);
  if (ts.isCallExpression(inner)) {
    const callee = inner.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
    return WRAPPERS.has(name) ? functionOf(sf, inner.arguments[0], depth + 1) : undefined;
  }
  return undefined;
};

export const findComponent = (sf: ts.SourceFile, exported: string) => {
  for (const statement of sf.statements) {
    if (exported === 'default' && ts.isExportAssignment(statement))
      return functionOf(sf, statement.expression);
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      const isDefault = ts
        .getModifiers(statement)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefault ? exported === 'default' : statement.name?.text === exported) return statement;
    }
    if (ts.isVariableStatement(statement) && isExported(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.name.text === exported)
          return functionOf(sf, declaration.initializer);
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      for (const element of statement.exportClause.elements)
        if (element.name.text === exported)
          return functionOf(sf, declarationOf(sf, (element.propertyName ?? element.name).text));
  }
  return undefined;
};

const importOf = (sf: ts.SourceFile, local: string) => {
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    const source = statement.moduleSpecifier.text;
    if (clause?.name?.text === local) return { imported: 'default', source };
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named) && named.name.text === local)
      return { imported: '*', source };
    if (named && ts.isNamedImports(named))
      for (const element of named.elements)
        if (element.name.text === local)
          return { imported: (element.propertyName ?? element.name).text, source };
  }
  return undefined;
};

const isReference = (node: ts.Identifier) => {
  const { parent } = node;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isJsxAttribute(parent) && parent.name === node) return false;
  return !(ts.isBindingElement(parent) && parent.propertyName === node);
};

const referencesIn = (root: ts.Node, name: string) => {
  const found: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && isReference(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
};

const outerOf = (node: ts.Node) => {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
};

const applicationAt = (reference: ts.Identifier, sf: ts.SourceFile) => {
  const outer = outerOf(reference);
  const holder = outer.parent;
  if (ts.isJsxExpression(holder) && ts.isJsxAttribute(holder.parent))
    return holder.parent.name.getText(sf) === 'className'
      ? { application: 'className' as const, attribute: holder.parent }
      : undefined;
  if (!ts.isCallExpression(holder) || holder.arguments.length !== 1) return undefined;
  const callee = holder.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'props') return undefined;
  if (
    !ts.isIdentifier(callee.expression) ||
    importOf(sf, callee.expression.text)?.source !== STYLEX
  )
    return undefined;
  const call = outerOf(holder);
  if (ts.isJsxSpreadAttribute(call.parent))
    return { application: 'spread' as const, attribute: call.parent };
  const access = call.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== 'className') return undefined;
  const value = outerOf(access).parent;
  return ts.isJsxExpression(value) &&
    ts.isJsxAttribute(value.parent) &&
    value.parent.name.getText(sf) === 'className'
    ? { application: 'props' as const, attribute: value.parent }
    : undefined;
};

const jsxChildren = (node: ts.Node) =>
  ts.isJsxElement(node) || ts.isJsxFragment(node)
    ? node.children.filter(
        (child): child is JsxNode => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
      )
    : [];

const rootReturn = (fn: ComponentFunction) => {
  if (!fn.body) return undefined;
  if (!ts.isBlock(fn.body)) return unwrap(fn.body);
  const returns = fn.body.statements.filter(ts.isReturnStatement);
  const last = returns.at(-1)?.expression;
  return last && unwrap(last);
};

const pathTo = (fn: ComponentFunction, element: JsxNode) => {
  const root = rootReturn(fn);
  const path: number[] = [];
  let node: ts.Node = element;
  while (node !== root) {
    const { parent } = node;
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
      path.unshift(jsxChildren(parent).indexOf(node as JsxNode));
      node = parent;
    } else if (ts.isParenthesizedExpression(parent)) node = parent;
    else return undefined;
  }
  return path;
};

const describe = (node: JsxNode, sf: ts.SourceFile, skip?: ts.Node) => {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = opening.tagName.getText(sf);
  const attributes: Record<string, LiteralValue> = {};
  for (const attribute of opening.attributes.properties) {
    if (attribute === skip) continue;
    if (ts.isJsxSpreadAttribute(attribute)) return { reason: 'FORWARD_ATTRIBUTES_UNMODELED:...' };
    const name = attribute.name.getText(sf);
    if (name === 'key' || name === 'ref' || /^on[A-Z]/.test(name)) continue;
    const { initializer } = attribute;
    const value = !initializer
      ? true
      : ts.isStringLiteral(initializer)
        ? initializer.text
        : ts.isJsxExpression(initializer) && initializer.expression
          ? literalOf(initializer.expression)
          : undefined;
    if (value !== undefined) attributes[name] = value;
    else if (STYLE_ATTRIBUTES.has(name)) return { reason: `FORWARD_ATTRIBUTES_UNMODELED:${name}` };
  }
  const tagImport = /^[a-z]/.test(tag) ? undefined : importOf(sf, tag);
  return { attributes, tag, ...(tagImport ? { tagImport } : {}) };
};

const elementOf = (attribute: ts.Node) => {
  const opening = attribute.parent.parent as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  return ts.isJsxOpeningElement(opening) ? opening.parent : opening;
};

export const applicationIn = (fn: ComponentFunction, prop: string, sf: ts.SourceFile) => {
  const [first] = fn.parameters;
  const pattern = first?.name;
  if (!pattern || !ts.isObjectBindingPattern(pattern))
    return { reason: 'FORWARD_PROP_NOT_DESTRUCTURED' };
  const binding = pattern.elements.find(
    (element) => (element.propertyName ?? element.name).getText(sf) === prop,
  );
  if (!binding || !ts.isIdentifier(binding.name))
    return { reason: 'FORWARD_PROP_NOT_DESTRUCTURED' };
  if (binding.initializer) return { reason: 'FORWARD_PROP_DEFAULTED' };
  const references = fn.body ? referencesIn(fn.body, binding.name.text) : [];
  if (references.length !== 1) return { reason: `FORWARD_APPLIED_${references.length}_TIMES` };
  const applied = applicationAt(references[0], sf);
  if (!applied) return { reason: 'FORWARD_APPLICATION_UNSUPPORTED' };
  const element = elementOf(applied.attribute);
  const path = pathTo(fn, element);
  if (!path) return { reason: 'FORWARD_CONDITIONAL' };
  return { application: applied.application, attribute: applied.attribute, element, path };
};

export const resolveForward = (code: string, exported: string, prop: string): ForwardResolution => {
  const sf = parse(code);
  const fn = findComponent(sf, exported);
  if (!fn) return { prop, reason: 'FORWARD_COMPONENT_NOT_FOUND' };
  const found = applicationIn(fn, prop, sf);
  if (!('element' in found) || !found.element) return { prop, reason: found.reason };
  const described = describe(found.element, sf, found.attribute);
  if ('reason' in described) return { prop, reason: described.reason };
  return { prop, target: { application: found.application, ...described, path: found.path } };
};

export const elementAtPath = (
  code: string,
  exported: string,
  path: number[],
): ForwardElement | { reason: string } => {
  const sf = parse(code);
  const fn = findComponent(sf, exported);
  const root = fn && rootReturn(fn);
  if (
    !root ||
    !(ts.isJsxElement(root) || ts.isJsxSelfClosingElement(root) || ts.isJsxFragment(root))
  )
    return { reason: 'FORWARD_BASE_MISSING' };
  let node: ts.Node | undefined = root;
  for (const index of path) node = node && jsxChildren(node)[index];
  if (!node || !(ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)))
    return { reason: 'FORWARD_BASE_MISSING' };
  const described = describe(node, sf);
  return 'reason' in described ? { reason: described.reason! } : { ...described, path };
};

export const componentOfStatement = (sf: ts.SourceFile, statement: ts.Statement) => {
  if (ts.isFunctionDeclaration(statement)) return statement;
  if (ts.isExportAssignment(statement)) return functionOf(sf, statement.expression);
  if (!ts.isVariableStatement(statement)) return undefined;
  const [declaration] = statement.declarationList.declarations;
  return statement.declarationList.declarations.length === 1
    ? functionOf(sf, declaration.initializer)
    : undefined;
};

export const FORWARDABLE_PROP = /^(?:className|xstyle|[a-z]\w*(?:ClassName|Xstyle))$/;

interface ForwardOptions {
  readBaseModule?: (fromFile: string, specifier: string) => string | undefined;
  readModule?: (fromFile: string, specifier: string) => string | undefined;
}

export const forwardsOf = (
  tag: string,
  bindings: Array<{ prop: string; spread: boolean }>,
  file: string,
  imports: Map<string, ts.ImportDeclaration>,
  options: ForwardOptions,
) => {
  const statement = imports.get(tag);
  if (/^[a-z]/.test(tag) || !statement || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
  const specifier = statement.moduleSpecifier.text;
  const clause = statement.importClause;
  const named = clause?.namedBindings;
  const exported =
    clause?.name?.text === tag
      ? 'default'
      : named && ts.isNamedImports(named)
        ? (named.elements.find((element) => element.name.text === tag)?.propertyName?.text ?? tag)
        : undefined;
  const code = exported && options.readModule?.(file, specifier);
  if (!exported || !code) return [];
  const baseCode = options.readBaseModule?.(file, specifier);
  return bindings
    .filter((binding) => !binding.spread && FORWARDABLE_PROP.test(binding.prop))
    .map((binding): ForwardResolution => {
      const resolution = resolveForward(code, exported, binding.prop);
      const { target } = resolution;
      if (!target) return resolution;
      const base =
        baseCode === undefined ? undefined : elementAtPath(baseCode, exported, target.path);
      if (!base)
        return { prop: binding.prop, target: { ...target, baseReason: 'FORWARD_BASE_UNREADABLE' } };
      return 'reason' in base
        ? { prop: binding.prop, target: { ...target, baseReason: base.reason } }
        : { prop: binding.prop, target: { ...target, base } };
    });
};
