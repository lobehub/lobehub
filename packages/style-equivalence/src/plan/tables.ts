import ts from 'typescript';

import type { StyleElement } from '../extract';
import { valueIdentifierNodes } from '../extract/identifiers';
import { parseExpression } from './knobs';

export const ABSENT_KEY = '__style_equivalence_absent__';

type Sides<T> = Record<'base' | 'head', T>;

const outerOf = (node: ts.Node) => {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return current;
};

const tablesRead = (chain: StyleElement[], name: string) => {
  const tables: string[] = [];
  for (const element of chain)
    for (const binding of element.bindings) {
      const parsed = parseExpression(binding.expr);
      if (!parsed) return undefined;
      for (const node of valueIdentifierNodes(parsed.expression)) {
        if (node.text !== name) continue;
        const access = node.parent;
        if (
          !ts.isElementAccessExpression(access) ||
          access.argumentExpression !== node ||
          !ts.isIdentifier(access.expression)
        )
          return undefined;
        const outer = outerOf(access);
        const { parent } = outer;
        if (
          (ts.isPropertyAccessExpression(parent) ||
            ts.isElementAccessExpression(parent) ||
            ts.isCallExpression(parent)) &&
          parent.expression === outer
        )
          return undefined;
        tables.push(access.expression.text);
      }
    }
  return tables;
};

export const tableDomain = (
  name: string,
  chains: Sides<StyleElement[]>,
  tables: Partial<Sides<Record<string, string[]> | undefined>>,
) => {
  const keySets: string[][] = [];
  for (const side of ['base', 'head'] as const) {
    const used = tablesRead(chains[side], name);
    if (!used?.length) return undefined;
    for (const table of used) {
      const keys = tables[side]?.[table];
      if (!keys?.length) return undefined;
      keySets.push(keys);
    }
  }
  const [first] = keySets;
  const signature = (keys: string[]) => JSON.stringify([...new Set(keys)].sort());
  if (keySets.some((keys) => signature(keys) !== signature(first))) return undefined;
  return [...new Set(first)].sort().concat(ABSENT_KEY);
};
