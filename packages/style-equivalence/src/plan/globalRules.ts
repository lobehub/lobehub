import ts from 'typescript';

import type { FileExtraction, StyleRule } from '../extract';
import { literalText } from '../extract/identifiers';
import { classNamesIn } from '../extract/selectors';
import { elementsOf } from './descendants';
import { resolve, signature } from './kept';
import { normalizeSelector } from './moved';

export const GLOBAL_RULES_CHANGED = 'GLOBAL_RULES_CHANGED';

const literalTokens = (expr: string) => {
  const tokens: string[] = [];
  const visit = (node: ts.Node) => {
    tokens.push(...(literalText(node)?.split(/\s+/).filter(Boolean) ?? []));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('t.ts', `(${expr});`, ts.ScriptTarget.Latest, true));
  return tokens;
};

export const carriedClasses = (extractions: FileExtraction[]) => {
  const carried = new Set<string>();
  for (const extraction of extractions) {
    extraction.literalClasses?.forEach((token) => carried.add(token));
    for (const element of elementsOf(extraction)) {
      for (const slot of element.slots)
        if (slot.startsWith('global.')) carried.add(slot.slice('global.'.length));
      for (const binding of element.bindings)
        for (const expr of [binding.expr, binding.expansion])
          if (expr) literalTokens(expr).forEach((token) => carried.add(token));
    }
  }
  return carried;
};

const signatureOf = (rule: StyleRule) => {
  const selector = normalizeSelector(resolve(rule.selector, rule));
  return selector === undefined ? `UNPARSED:${rule.selector}` : signature(rule, selector);
};

export const globalRuleSignatures = (extraction: FileExtraction, carried: Set<string>) =>
  [
    ...extraction.rules.filter((rule) => rule.stylesheet && !Object.keys(rule.owned).length),
    ...(extraction.globalRules ?? []),
  ]
    .filter((rule) => rule.declarations?.length || rule.stylesheet?.startsWith('unparsed:'))
    .filter((rule) => !classNamesIn(rule.selector).some((name) => carried.has(name)))
    .map(signatureOf);

export const globalRulesChanged = (
  base: FileExtraction,
  head: FileExtraction,
  carried: Set<string>,
) => {
  const before = globalRuleSignatures(base, carried);
  const after = globalRuleSignatures(head, carried);
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  const removed = before.filter((item) => !after.includes(item)).length;
  const added = after.filter((item) => !before.includes(item)).length;
  return `${GLOBAL_RULES_CHANGED}:${removed}/${added}`;
};
