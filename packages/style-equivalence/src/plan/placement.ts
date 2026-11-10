import ts from 'typescript';

import type { StyleBinding, StyleElement } from '../extract';
import { knobText } from './knobs';
import { propertiesOverlap } from './properties';

type Canonical = { entries: Record<string, Canonical> } | { terms: string[] };

export type SlotProperties = Record<string, string[]>;

interface Unit {
  outside: number;
  propsCalls: number;
  slots: Set<string>;
}

interface Context {
  atoms: string[];
  depth: number;
  joins: Array<Array<Set<string>>>;
  unit: Unit;
  units: Unit[];
}

const newUnit = (): Unit => ({ outside: 0, propsCalls: 0, slots: new Set() });

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
  ctx.unit.propsCalls += 1;
  ctx.depth += 1;
  const terms = termsOfAll(call.arguments, ctx);
  ctx.depth -= 1;
  return terms;
};

const containsProps = (root: ts.Node): boolean =>
  (ts.isCallExpression(root) && isStylexProps(root)) || !!ts.forEachChild(root, containsProps);

const isSpaceLiteral = (node: ts.Expression | undefined) =>
  !!node && ts.isStringLiteralLike(node) && node.text === ' ';

const joinedSources = (node: ts.Expression): readonly ts.Expression[] | undefined => {
  if (ts.isTemplateExpression(node)) {
    const literals = node.templateSpans.map((span) => span.literal.text);
    const separated = literals.slice(0, -1).every((text) => /^\s+$/.test(text));
    return separated && /^\s*$/.test(node.head.text) && /^\s*$/.test(literals.at(-1) ?? '')
      ? node.templateSpans.map((span) => span.expression)
      : undefined;
  }
  if (!ts.isCallExpression(node)) return undefined;
  if (ts.isIdentifier(node.expression) && MERGERS.has(node.expression.text))
    return node.arguments.filter(containsProps).length > 1 ? node.arguments : undefined;
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'join')
    return undefined;
  if (node.arguments.length !== 1 || !isSpaceLiteral(node.arguments[0])) return undefined;
  let target = unwrap(node.expression.expression);
  if (
    ts.isCallExpression(target) &&
    ts.isPropertyAccessExpression(target.expression) &&
    target.expression.name.text === 'filter' &&
    target.arguments.length === 1 &&
    compact(target.arguments[0]) === 'Boolean'
  )
    target = unwrap(target.expression.expression);
  if (!ts.isArrayLiteralExpression(target)) return undefined;
  return target.elements.some(ts.isSpreadElement) ? undefined : target.elements;
};

const joinTerms = (sources: readonly ts.Expression[], ctx: Context) => {
  if (ctx.depth > 0) return undefined;
  const outer = ctx.unit;
  const groups: Array<Set<string>> = [];
  const terms: string[] = [];
  for (const source of sources) {
    ctx.unit = newUnit();
    ctx.units.push(ctx.unit);
    groups.push(ctx.unit.slots);
    const part = termsOf(source, ctx);
    ctx.unit = outer;
    if (!part) return undefined;
    terms.push(...part);
  }
  ctx.joins.push(groups);
  return terms;
};

function termsOf(raw: ts.Expression, ctx: Context): string[] | undefined {
  const node = unwrap(raw);
  if (EMPTY.has(compact(node))) return [];
  if (ts.isStringLiteralLike(node))
    return node.text
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => JSON.stringify(token));
  if (ts.isIdentifier(node)) {
    ctx.unit.slots.add(node.text);
    return [node.text];
  }
  const sources = joinedSources(node);
  if (sources) return joinTerms(sources, ctx);
  if (ts.isPropertyAccessExpression(node)) {
    const target = unwrap(node.expression);
    if (node.name.text === 'className' && ts.isCallExpression(target) && isStylexProps(target))
      return propsTerms(target, ctx);
    if (!ts.isIdentifier(target)) return undefined;
    if (ctx.depth === 0) ctx.unit.outside += 1;
    ctx.unit.slots.add(compact(node));
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
  ) {
    ctx.atoms.push(knobText(unwrap(node.left)));
    return prefixed(node.right, `${compact(node.left)}&&`, ctx);
  }
  if (ts.isConditionalExpression(node)) {
    ctx.atoms.push(knobText(unwrap(node.condition)));
    const condition = compact(node.condition);
    const whenTrue = prefixed(node.whenTrue, `${condition}?`, ctx);
    const whenFalse = prefixed(node.whenFalse, `${condition}:`, ctx);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  return undefined;
}

const joinsDisjoint = (joins: Context['joins'], properties: SlotProperties | undefined) =>
  joins.every((groups) => {
    const sets = groups.map((slots) => [...slots].map((slot) => properties?.[slot]));
    if (sets.some((set) => set.some((entry) => !entry))) return false;
    const flat = sets.map((set) => (set as string[][]).flat());
    return flat.every((left, index) =>
      flat.slice(index + 1).every((right) => !propertiesOverlap(left, right)),
    );
  });

const canonicalOf = (
  raw: ts.Expression,
  properties: SlotProperties | undefined,
  atoms: string[],
  spread = false,
): Canonical | undefined => {
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
      const value = canonicalOf(property.initializer, properties, atoms);
      if (!value) return undefined;
      entries[name.text] = value;
    }
    return { entries };
  }
  const unit = newUnit();
  const ctx: Context = { atoms, depth: 0, joins: [], unit, units: [unit] };
  const terms =
    spread && ts.isCallExpression(node) && isStylexProps(node)
      ? propsTerms(node, ctx)
      : termsOf(node, ctx);
  if (!terms) return undefined;
  const merged = ctx.units.every(
    (item) => item.propsCalls <= 1 && !(item.propsCalls === 1 && item.outside > 0),
  );
  return merged && joinsDisjoint(ctx.joins, properties) ? { terms } : undefined;
};

const isSx = (node: ts.Expression): node is ts.CallExpression =>
  ts.isCallExpression(node) && compact(node.expression) === 'sx';

const slotReferences = (root: ts.Node, found: string[] = []): string[] => {
  if (ts.isPropertyAccessExpression(root) && ts.isIdentifier(unwrap(root.expression)))
    found.push(compact(root));
  else ts.forEachChild(root, (child) => void slotReferences(child, found));
  return found;
};

const isStylexArgument = (node: ts.Expression, properties: SlotProperties | undefined) => {
  const references = slotReferences(node);
  return references.length > 0 && references.every((reference) => !!properties?.[reference]);
};

const sxArguments = (call: ts.CallExpression) => {
  const found: Array<{ node: ts.Expression; stylex?: true }> = [];
  for (const argument of call.arguments) {
    const node = unwrap(argument);
    if (!ts.isArrayLiteralExpression(node)) {
      found.push({ node });
      continue;
    }
    if (node.elements.some(ts.isSpreadElement)) return undefined;
    for (const element of node.elements) found.push({ node: unwrap(element), stylex: true });
  }
  return found;
};

const sxValue = (
  call: ts.CallExpression,
  properties: SlotProperties | undefined,
  atoms: string[],
) => {
  const argumentsOf = sxArguments(call);
  if (!argumentsOf?.length) return undefined;
  const unit = newUnit();
  const ctx: Context = { atoms, depth: 0, joins: [], unit, units: [unit] };
  ctx.unit.propsCalls += 1;
  const terms: string[] = [];
  for (const { node, stylex: inArray } of argumentsOf) {
    if (ts.isObjectLiteralExpression(node)) {
      if (node.properties.length === 0) continue;
      return undefined;
    }
    const stylex = inArray || isStylexArgument(node, properties);
    if (stylex) ctx.depth += 1;
    const part = termsOf(node, ctx);
    if (stylex) ctx.depth -= 1;
    if (!part) return undefined;
    terms.push(...part);
  }
  const merged = ctx.units.every(
    (item) => item.propsCalls <= 1 && !(item.propsCalls === 1 && item.outside > 0),
  );
  return merged && joinsDisjoint(ctx.joins, properties)
    ? { prop: 'className', value: { terms } }
    : undefined;
};

const normalize = (binding: StyleBinding, properties?: SlotProperties, atoms: string[] = []) => {
  const expression = parse(binding.expr);
  if (!expression) return undefined;
  if (binding.spread) {
    if (isSx(expression)) return sxValue(expression, properties, atoms);
    if (!isStylexProps(expression)) return undefined;
    const value = canonicalOf(expression, properties, atoms, true);
    return value && { prop: 'className', value };
  }
  const value = canonicalOf(expression, properties, atoms);
  return value && { prop: binding.prop, value };
};

const sortedJson = (value: unknown) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

const sameElement = (base: StyleElement, head: StyleElement, properties: SideProperties) => {
  if (base.tag !== head.tag) return false;
  if (sortedJson(base.literalProps) !== sortedJson(head.literalProps)) return false;
  if (sortedJson(base.attributes ?? {}) !== sortedJson(head.attributes ?? {})) return false;
  if (base.bindings.length !== head.bindings.length) return false;
  return base.bindings.every((binding, index) => {
    const left = normalize(binding, properties.base);
    const right = normalize(head.bindings[index], properties.head);
    return !!left && !!right && sortedJson(left) === sortedJson(right);
  });
};

export type SideProperties = Partial<Record<'base' | 'head', SlotProperties>>;

export interface PlacementOptions {
  layoutComponents?: string[];
  properties?: SideProperties;
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
        ? sameElement(element, other, options.properties ?? {})
        : true;
    })
  );
};

const canonicalChain = (chain: StyleElement[], properties: SlotProperties | undefined) => {
  const atoms: string[] = [];
  const elements = [];
  for (const element of chain) {
    const bindings = [];
    for (const binding of element.bindings) {
      const value = normalize(binding, properties, atoms);
      if (!value) return undefined;
      bindings.push(value);
    }
    elements.push({ bindings, tag: element.tag });
  }
  return { atoms: [...new Set(atoms)], shape: sortedJson(elements) };
};

export const sharedConditions = (
  base: StyleElement[],
  head: StyleElement[],
  properties: SideProperties = {},
) => {
  const left = canonicalChain(base, properties.base);
  const right = canonicalChain(head, properties.head);
  if (!left || !right || left.shape !== right.shape) return undefined;
  return sortedJson(left.atoms) === sortedJson(right.atoms) ? left.atoms : undefined;
};
