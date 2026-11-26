import selectorParser from 'postcss-selector-parser';
import ts from 'typescript';

import type { FileExtraction, StyleElement, StyleRule } from '../extract';
import { SELF } from '../extract/css';
import { classNamesIn } from '../extract/selectors';
import { elementsOf } from './descendants';
import { type InnerNode, innerTargets } from './inner';

export interface MovedProof {
  head: string;
  nodes: InnerNode[];
  placement?: string;
  rules: StyleRule[];
  slots: string[];
  tokens: string[];
}

const literalTokens = (element: StyleElement) => {
  const tokens = new Set<string>();
  for (const binding of element.bindings) {
    const source = ts.createSourceFile('t.ts', `(${binding.expr});`, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        for (const token of node.text.split(/\s+/)) if (token) tokens.add(token);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return tokens;
};

export const normalizeSelector = (selector: string, from?: string, to?: string) => {
  let count = 0;
  let selectors = 0;
  try {
    const result = selectorParser((root) => {
      selectors = root.nodes.length;
      root.walkAttributes((node) => {
        if (node.value !== undefined) node.quoteMark = '"';
      });
      if (from === undefined) return;
      root.walkClasses((node) => {
        if (node.value !== from) return;
        count += 1;
        node.value = to!;
      });
    }).processSync(selector, { lossless: false });
    return from === undefined || count === selectors ? result : undefined;
  } catch {
    return undefined;
  }
};

const emitted = (rules: StyleRule[]) => rules.filter((rule) => rule.declarations?.length);

const sameRule = (base: StyleRule, head: StyleRule, token: string) => {
  const selector = normalizeSelector(base.selector, SELF, token);
  return (
    !!selector &&
    selector === normalizeSelector(head.selector) &&
    !base.conditions.some((condition) => condition.startsWith('@layer')) &&
    JSON.stringify(base.conditions) === JSON.stringify(head.conditions) &&
    JSON.stringify(base.declarations) === JSON.stringify(head.declarations)
  );
};

const isSlotAccess = (expr: string, slot: string) => expr.replaceAll(/\s+/g, '') === slot;

const placementOf = (base: StyleElement, head: StyleElement, slot: string, token: string) => {
  const [left] = base.bindings;
  const [right] = head.bindings;
  if (base.bindings.length !== 1 || head.bindings.length !== 1) return undefined;
  if (left.spread || right.spread || left.prop !== 'className' || right.prop !== 'className')
    return undefined;
  const literal = ts.createSourceFile('t.ts', `(${right.expr});`, ts.ScriptTarget.Latest, true);
  const [statement] = literal.statements;
  const value = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
  const inner = value && ts.isParenthesizedExpression(value) ? value.expression : value;
  return inner &&
    ts.isStringLiteralLike(inner) &&
    inner.text.trim() === token &&
    isSlotAccess(left.expr, slot)
    ? left.expr
    : undefined;
};

const proveElement = (
  base: StyleElement,
  head: StyleElement,
  rules: { base: StyleRule[]; head: StyleRule[] },
): MovedProof | undefined => {
  const tokens = literalTokens(head);
  const moved: StyleRule[] = [];
  const selectors: string[] = [];
  const slots: string[] = [];
  const used: string[] = [];
  let placement: string | undefined;
  for (const slot of base.slots) {
    const own = emitted(rules.base.filter((rule) => rule.slot === slot));
    if (!own.length) continue;
    const token = [...tokens].find((candidate) => {
      const targets = emitted(
        rules.head.filter(
          (rule) => rule.stylesheet && classNamesIn(rule.selector).includes(candidate),
        ),
      );
      return (
        targets.length === own.length &&
        own.every((rule, index) => sameRule(rule, targets[index], candidate))
      );
    });
    if (!token) return undefined;
    slots.push(slot);
    used.push(token);
    moved.push(
      ...rules.head.filter(
        (rule) => rule.stylesheet && classNamesIn(rule.selector).includes(token),
      ),
    );
    selectors.push(...own.map((rule) => rule.selector));
    placement = base.slots.length === 1 ? placementOf(base, head, slot, token) : undefined;
  }
  if (!moved.length) return undefined;
  const nodes = innerTargets(selectors, SELF);
  return nodes && { head: head.id, nodes, placement, rules: moved, slots, tokens: used };
};

export const movedStylesheets = (
  base: FileExtraction,
  head: FileExtraction,
  pairs: Array<[StyleElement, StyleElement]>,
) => {
  const proofs = new Map<string, MovedProof>();
  const slotUsers = (slot: string) =>
    elementsOf(base).filter((element) => element.slots.includes(slot)).length;
  const tokenUsers = new Map<string, number>();
  for (const element of head.elements)
    for (const token of literalTokens(element))
      tokenUsers.set(token, (tokenUsers.get(token) ?? 0) + 1);
  for (const [left, right] of pairs) {
    const proof = proveElement(left, right, { base: base.rules, head: head.rules });
    if (!proof) continue;
    const unique =
      proof.slots.every((slot) => slotUsers(slot) === 1) &&
      proof.tokens.every((token) => tokenUsers.get(token) === 1);
    if (unique) proofs.set(left.id, proof);
  }
  const used = new Set([...proofs.values()].flatMap((proof) => proof.rules));
  const incomplete = new Set(
    emitted(head.rules)
      .filter((rule) => rule.stylesheet && !used.has(rule))
      .map((rule) => rule.stylesheet),
  );
  for (const [id, proof] of proofs)
    if (proof.rules.some((rule) => incomplete.has(rule.stylesheet))) proofs.delete(id);
  return proofs;
};
