import ts from 'typescript';

import type { StyleBinding, StyleElement } from '../extract';

type Canonical = { entries: Record<string, Canonical> } | { terms: string[] };

interface Context {
  depth: number;
  outside: number;
  propsCalls: number;
}

const EMPTY = new Set(['false', 'null', 'undefined']);
const MERGERS = new Set(['clsx', 'cx']);

const parse = (expr: string) => {
  const source = ts.createSourceFile('placement.ts', `(${expr});`, ts.ScriptTarget.Latest, true);
  const [statement] = source.statements;
  return statement && ts.isExpressionStatement(statement)
    ? unwrap(statement.expression)
    : undefined;
};

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const compact = (node: ts.Node) => node.getText().replaceAll(/\s+/g, '');

const isStylexProps = (node: ts.Expression) =>
  ts.isCallExpression(node) && compact(node.expression) === 'stylex.props';

const termsOfAll = (nodes: readonly ts.Expression[], ctx: Context) => {
  const terms: string[] = [];
  for (const node of nodes) {
    const part = termsOf(node, ctx);
    if (!part) return undefined;
    terms.push(...part);
  }
  return terms;
};

const prefixed = (node: ts.Expression, prefix: string, ctx: Context) =>
  termsOf(node, ctx)?.map((term) => `${prefix}${term}`);

const propsTerms = (call: ts.CallExpression, ctx: Context) => {
  ctx.propsCalls += 1;
  ctx.depth += 1;
  const terms = termsOfAll(call.arguments, ctx);
  ctx.depth -= 1;
  return terms;
};

function termsOf(raw: ts.Expression, ctx: Context): string[] | undefined {
  const node = unwrap(raw);
  if (EMPTY.has(compact(node))) return [];
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const target = unwrap(node.expression);
    if (node.name.text === 'className' && ts.isCallExpression(target) && isStylexProps(target))
      return propsTerms(target, ctx);
    if (!ts.isIdentifier(target)) return undefined;
    if (ctx.depth === 0) ctx.outside += 1;
    return [compact(node)];
  }
  if (ts.isCallExpression(node)) {
    if (isStylexProps(node)) return undefined;
    return ts.isIdentifier(node.expression) && MERGERS.has(node.expression.text)
      ? termsOfAll(node.arguments, ctx)
      : undefined;
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  )
    return prefixed(node.right, `${compact(node.left)}&&`, ctx);
  if (ts.isConditionalExpression(node)) {
    const condition = compact(node.condition);
    const whenTrue = prefixed(node.whenTrue, `${condition}?`, ctx);
    const whenFalse = prefixed(node.whenFalse, `${condition}:`, ctx);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  return undefined;
}

const canonicalOf = (raw: ts.Expression, spread = false): Canonical | undefined => {
  const node = unwrap(raw);
  if (ts.isObjectLiteralExpression(node)) {
    const entries: Record<string, Canonical> = {};
    for (const property of node.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        entries[property.name.text] = { terms: [property.name.text] };
        continue;
      }
      if (!ts.isPropertyAssignment(property)) return undefined;
      const { name } = property;
      if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return undefined;
      const value = canonicalOf(property.initializer);
      if (!value) return undefined;
      entries[name.text] = value;
    }
    return { entries };
  }
  const ctx: Context = { depth: 0, outside: 0, propsCalls: 0 };
  const terms =
    spread && ts.isCallExpression(node) && isStylexProps(node)
      ? propsTerms(node, ctx)
      : termsOf(node, ctx);
  if (!terms || ctx.propsCalls > 1) return undefined;
  return ctx.propsCalls === 1 && ctx.outside > 0 ? undefined : { terms };
};

const normalize = (binding: StyleBinding) => {
  const expression = parse(binding.expr);
  if (!expression) return undefined;
  if (binding.spread) {
    if (!isStylexProps(expression)) return undefined;
    const value = canonicalOf(expression, true);
    return value && { prop: 'className', value };
  }
  const value = canonicalOf(expression);
  return value && { prop: binding.prop, value };
};

const sortedJson = (value: unknown) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

const sameElement = (base: StyleElement, head: StyleElement) => {
  if (base.tag !== head.tag) return false;
  if (sortedJson(base.literalProps) !== sortedJson(head.literalProps)) return false;
  if (base.bindings.length !== head.bindings.length) return false;
  return base.bindings.every((binding, index) => {
    const left = normalize(binding);
    const right = normalize(head.bindings[index]);
    return !!left && !!right && sortedJson(left) === sortedJson(right);
  });
};

export interface PlacementOptions {
  layoutComponents?: string[];
}

export const isIntrinsicTag = (tag: string) => /^[a-z][\w-]*$/.test(tag);

const placementSensitive = (element: StyleElement, layout: Set<string>) =>
  (!isIntrinsicTag(element.tag) && !layout.has(element.tag)) ||
  element.bindings.some((binding) => !binding.spread && binding.prop !== 'className');

export const placementPreserved = (
  base: StyleElement[],
  head: StyleElement[],
  options: PlacementOptions = {},
) => {
  const layout = new Set(options.layoutComponents);
  return (
    base.length === head.length &&
    base.every((element, index) => {
      const other = head[index];
      if (element.tag !== other.tag) return false;
      return placementSensitive(element, layout) || placementSensitive(other, layout)
        ? sameElement(element, other)
        : true;
    })
  );
};
