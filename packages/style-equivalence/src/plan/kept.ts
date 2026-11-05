import ts from 'typescript';

import type { FileExtraction, StyleElement, StyleRule } from '../extract';
import { SELF } from '../extract/css';
import { classNamesIn } from '../extract/selectors';
import { type InnerNode, innerTargets } from './inner';
import { normalizeSelector } from './moved';
import { parseSelectorList } from './selectorTree';

export interface KeptProof {
  head: string;
  nodes: InnerNode[];
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

const compact = (node: ts.Node) => node.getText().replaceAll(/\s+/g, '');

const segmentOf = (node: ts.Node, parent: ts.Node): string | null | undefined => {
  if (TRANSPARENT.has(parent.kind)) return null;
  if (ts.isCallExpression(parent))
    return parent.arguments.includes(node as ts.Expression) ? null : undefined;
  if (ts.isPropertyAccessExpression(parent))
    return ts.isCallExpression(node) && parent.name.text === 'className' ? null : undefined;
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
    const source = ts.createSourceFile('t.ts', `(${binding.expr});`, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && compact(node) === slot) {
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

const slotsOf = (rule: StyleRule) =>
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

const resolve = (text: string, rule: StyleRule) =>
  text.replaceAll(/__I(\d+)__/g, (match, index: string) => {
    const expression = rule.interpolations?.[Number(index)];
    return expression === undefined ? match : `\${${expression}}`;
  });

const signature = (rule: StyleRule) => {
  const selector = normalizeSelector(resolve(rule.selector, rule));
  return (
    selector &&
    JSON.stringify({
      conditions: rule.conditions.map((condition) => resolve(condition, rule)),
      declarations: rule.declarations?.map((declaration) => resolve(declaration, rule)),
      selector,
    })
  );
};

const proveElement = (
  base: StyleElement,
  head: StyleElement,
  rules: { base: StyleRule[]; head: StyleRule[] },
): KeptProof | undefined => {
  const required = rulesOn(base, rules.base).filter(descendant);
  const kept = rulesOn(head, rules.head);
  if (!required.length || required.length !== kept.length) return undefined;
  const matched = required.every((left, index) => {
    const right = kept[index];
    if (!left.slot || !right.slot || left.stylesheet || right.stylesheet) return false;
    const signed = signature(left);
    const placement = placementOf(base, left.slot);
    return (
      !!signed &&
      signed === signature(right) &&
      !!placement &&
      placement === placementOf(head, right.slot)
    );
  });
  const nodes = matched
    ? innerTargets(
        required.map((rule) => rule.selector),
        SELF,
      )
    : undefined;
  return nodes?.length ? { head: head.id, nodes } : undefined;
};

export const keptEmotionRules = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Array<[StyleElement, StyleElement]>,
) => {
  const proofs = new Map<string, KeptProof>();
  for (const [left, right] of pairs) {
    const proof = proveElement(left, right, { base: base.rules, head: head.rules });
    if (proof) proofs.set(left.id, proof);
  }
  return proofs;
};
