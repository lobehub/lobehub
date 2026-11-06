import ts from 'typescript';

import type { FileExtraction, StyleElement, StyleRule } from '../extract';
import { SELF } from '../extract/css';
import { literalText } from '../extract/identifiers';
import { classNamesIn } from '../extract/selectors';
import { elementsOf } from './descendants';
import { type InnerNode, innerTargets } from './inner';
import { normalizeSelector } from './moved';
import { parseSelectorList } from './selectorTree';

export interface KeptProof {
  exhaustive: boolean;
  head: string;
  nodes: InnerNode[];
  placement?: string;
}

const TRANSPARENT = new Set([
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.SpreadElement,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateSpan,
]);

const JOINERS = new Set(['filter', 'join']);

const compact = (node: ts.Node) => node.getText().replaceAll(/\s+/g, '');

const segmentOf = (node: ts.Node, parent: ts.Node): string | null | undefined => {
  if (TRANSPARENT.has(parent.kind)) return null;
  if (ts.isCallExpression(parent)) {
    if (parent.arguments.includes(node as ts.Expression)) return null;
    return parent.expression === node && ts.isPropertyAccessExpression(node) ? null : undefined;
  }
  if (ts.isPropertyAccessExpression(parent)) {
    if (ts.isCallExpression(node) && parent.name.text === 'className') return null;
    return parent.expression === node && JOINERS.has(parent.name.text) ? null : undefined;
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const { name } = parent;
    return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? `key:${name.text}` : undefined;
  }
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    if (operator === ts.SyntaxKind.PlusToken) return null;
    const guarded = [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(operator);
    return guarded && parent.right === node
      ? `${ts.tokenToString(operator)}(${compact(parent.left)})`
      : undefined;
  }
  if (ts.isConditionalExpression(parent)) {
    if (parent.whenTrue === node) return `?(${compact(parent.condition)})`;
    if (parent.whenFalse === node) return `!?(${compact(parent.condition)})`;
  }
  return undefined;
};

const pathFrom = (node: ts.Node) => {
  const segments: string[] = [];
  for (let current = node; !ts.isExpressionStatement(current.parent); current = current.parent) {
    const segment = segmentOf(current, current.parent);
    if (segment === undefined) return undefined;
    if (segment) segments.unshift(segment);
  }
  return segments;
};

const placementOf = (element: StyleElement, slot: string) => {
  const found: string[][] = [];
  for (const binding of element.bindings) {
    const source = ts.createSourceFile(
      't.ts',
      `(${binding.expansion ?? binding.expr});`,
      ts.ScriptTarget.Latest,
      true,
    );
    const token = slot.startsWith('global.') ? slot.slice('global.'.length) : undefined;
    const matches = (node: ts.Node) =>
      token
        ? !!literalText(node)?.split(/\s+/).includes(token)
        : ts.isPropertyAccessExpression(node) && compact(node) === slot;
    const visit = (node: ts.Node) => {
      if (matches(node)) {
        const path = pathFrom(node);
        if (!path) return found.push(['?']);
        const keyed = path.some((segment) => segment.startsWith('key:'));
        const root = binding.spread ? (keyed ? [] : ['key:className']) : [`key:${binding.prop}`];
        found.push([...root, ...path]);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const [only] = found;
  return found.length === 1 && only[0] !== '?' ? JSON.stringify(only) : undefined;
};

export const slotsOf = (rule: StyleRule) =>
  classNamesIn(rule.selector).flatMap((name) =>
    [rule.owned[name], rule.stylesheet ? `global.${name}` : undefined].filter(
      (slot): slot is string => !!slot,
    ),
  );

const rulesOn = (element: StyleElement, rules: StyleRule[]) =>
  rules.filter(
    (rule) =>
      rule.declarations?.length && slotsOf(rule).some((slot) => element.slots.includes(slot)),
  );

const descendant = (rule: StyleRule) =>
  (parseSelectorList(rule.selector) ?? []).some((nodes) =>
    nodes.some((node) => node.type === 'combinator'),
  );

const kebab = (name: string) =>
  name
    .replaceAll(/([a-z\d])([A-Z])/g, '$1-$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replaceAll(/([a-z])(\d)/g, '$1-$2')
    .toLowerCase();

const tokenValue = (expression: string) => {
  const token = /^cssVar\.(\w+)$/.exec(expression);
  return token ? `var(--lobe-${kebab(token[1])})` : `\${${expression}}`;
};

export const resolve = (text: string, rule: StyleRule) =>
  text.replaceAll(/__I(\d+)__/g, (match, index: string) => {
    const value = rule.interpolationValues?.[Number(index)];
    if (typeof value === 'string') return value;
    const expression = rule.interpolations?.[Number(index)];
    return expression === undefined ? match : tokenValue(expression);
  });

const hostSlot = (rule: StyleRule, element: StyleElement) => {
  const slots = [...new Set(slotsOf(rule).filter((slot) => element.slots.includes(slot)))];
  return slots.length === 1 ? slots[0] : undefined;
};

const hostSelector = (rule: StyleRule, slot: string) =>
  rule.stylesheet
    ? normalizeSelector(rule.selector, slot.slice('global.'.length), SELF)
    : normalizeSelector(resolve(rule.selector, rule));

export const signature = (rule: StyleRule, selector: string) =>
  JSON.stringify({
    conditions: rule.conditions.map((condition) => resolve(condition, rule)),
    declarations: rule.declarations?.map((declaration) => resolve(declaration, rule)),
    selector,
  });

const literalTokens = (element: StyleElement) =>
  element.bindings.flatMap((binding) => {
    const source = ts.createSourceFile(
      't.ts',
      `(${binding.expansion ?? binding.expr});`,
      ts.ScriptTarget.Latest,
      true,
    );
    const tokens: string[] = [];
    const visit = (node: ts.Node) => {
      tokens.push(...(literalText(node)?.split(/\s+/).filter(Boolean) ?? []));
      ts.forEachChild(node, visit);
    };
    visit(source);
    return tokens;
  });

const placementSwap = (base: StyleElement, head: StyleElement, slots: [string, string]) => {
  const [binding] = head.bindings;
  if (base.bindings.length !== 1 || head.bindings.length !== 1 || binding.expansion)
    return undefined;
  const escaped = slots[1].replaceAll(/[$.]/g, (char) => `\\${char}`);
  const parts = binding.expr.split(new RegExp(`(?<![\\w$.])${escaped}(?![\\w$])`));
  if (parts.length !== 2) return undefined;
  const own = slots[0].startsWith('global.')
    ? JSON.stringify(slots[0].slice('global.'.length))
    : slots[0];
  return parts.join(own);
};

interface Context {
  base: FileExtraction;
  head: FileExtraction;
}

const proveElement = (
  base: StyleElement,
  head: StyleElement,
  { base: before, head: after }: Context,
): KeptProof | undefined => {
  const all = rulesOn(base, before.rules);
  const required = all.filter(descendant);
  const kept = rulesOn(head, after.rules);
  if (!required.length || required.length !== kept.length) return undefined;
  const selectors: string[] = [];
  const slots = new Set<string>();
  const users = (slot: string) =>
    elementsOf(before).filter((element) => element.slots.includes(slot)).length;
  for (const [index, left] of required.entries()) {
    const right = kept[index];
    const leftSlot = hostSlot(left, base);
    const rightSlot = hostSlot(right, head);
    if (!leftSlot || !rightSlot || !right.slot || right.stylesheet) return undefined;
    if (left.stylesheet ? !leftSlot.startsWith('global.') || users(leftSlot) !== 1 : !left.slot)
      return undefined;
    const selector = hostSelector(left, leftSlot);
    const placement = placementOf(base, leftSlot);
    if (
      !selector ||
      selector !== hostSelector(right, rightSlot) ||
      signature(left, selector) !== signature(right, selector) ||
      !placement ||
      placement !== placementOf(head, rightSlot)
    )
      return undefined;
    selectors.push(selector);
    slots.add(`${leftSlot}\n${rightSlot}`);
  }
  const nodes = innerTargets(
    selectors.filter((selector) => innerTargets([selector], SELF)),
    SELF,
  );
  const pairs = [...slots].map((entry) => entry.split('\n') as [string, string]);
  const globals = new Set(pairs.flatMap(([slot]) => (slot.startsWith('global.') ? [slot] : [])));
  const exhaustive =
    all.length === required.length &&
    literalTokens(base).every((token) => globals.has(`global.${token}`)) &&
    !literalTokens(head).length;
  const placement = pairs.length === 1 ? placementSwap(base, head, pairs[0]) : undefined;
  return { exhaustive, head: head.id, nodes: nodes ?? [], ...(placement ? { placement } : {}) };
};

export const keptEmotionRules = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Array<[StyleElement, StyleElement]>,
) => {
  const proofs = new Map<string, KeptProof>();
  for (const [left, right] of pairs) {
    const proof = proveElement(left, right, { base, head });
    if (proof) proofs.set(left.id, proof);
  }
  return proofs;
};
