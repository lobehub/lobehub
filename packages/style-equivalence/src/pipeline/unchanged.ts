import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import type { FileExtraction } from '../extract';
import { valueIdentifierNodes } from '../extract/identifiers';
import { elementsOf } from '../plan/descendants';
import { chainOf, type FilePlan, type Side } from '../plan/planFile';
import {
  declarationText,
  findStyleMember,
  parseSource,
  resolveSlot,
  type SlotSite,
} from '../source/declarations';

export const CHAIN_CLEARABLE = new Set(['COMBINATIONS_PAIRWISE', 'VARIABLE_UNMODELED']);

const CALLER_FLAGS = ['FORWARDED_CALLER_UNCHECKED', 'INNER_TARGET_PARTLY_FORWARDED'];

const MAX_DEPTH = 4;

const topLevelOf = (sf: ts.SourceFile) => {
  const statements = new Map<string, ts.Statement>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) statements.set(clause.name.text, statement);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) statements.set(named.name.text, statement);
      if (named && ts.isNamedImports(named))
        for (const element of named.elements) statements.set(element.name.text, statement);
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) statements.set(declaration.name.text, statement);
    if ((ts.isFunctionDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name)
      statements.set(statement.name.text, statement);
  }
  return statements;
};

export const slotClosure = (site: SlotSite) => {
  if (site.css) return declarationText(site);
  const sf = parseSource(site.code);
  const member = findStyleMember(sf, site.symbol, site.member);
  if (!member) return undefined;
  const statements = topLevelOf(sf);
  const texts = [member.getText(sf)];
  const seen = new Set<ts.Statement>();
  const visit = (node: ts.Node, depth: number) => {
    for (const identifier of valueIdentifierNodes(node)) {
      if (identifier.text === site.symbol) continue;
      const statement = statements.get(identifier.text);
      if (!statement || seen.has(statement)) continue;
      if (depth >= MAX_DEPTH) return false;
      seen.add(statement);
      texts.push(statement.getText(sf));
      if (!ts.isImportDeclaration(statement) && visit(statement, depth + 1) === false) return false;
    }
    return true;
  };
  return visit(member, 0) ? texts.join('\n') : undefined;
};

const chainSignature = (extraction: FileExtraction, id: string) => {
  const byId = new Map(elementsOf(extraction).map((element) => [element.id, element]));
  const element = byId.get(id);
  if (!element) return undefined;
  const chain = chainOf(element, byId);
  return {
    slots: [...new Set(chain.flatMap((item) => item.slots))].sort(),
    text: JSON.stringify(
      chain.map(
        ({ flags: _flags, id: _id, parent: _parent, children: _children, ...item }) => item,
      ),
    ),
  };
};

export interface UnchangedContext {
  aliases: Record<string, string>;
  roots: Record<Side, string>;
  sources: Partial<Record<Side, string>>;
}

export const markUnchangedChains = (
  plan: FilePlan,
  pair: Record<Side, FileExtraction>,
  context: UnchangedContext,
) => {
  const { base: baseSource, head: headSource } = context.sources;
  if (!baseSource || !headSource) return;
  const codes = {
    base: readFileSync(path.join(context.roots.base, baseSource), 'utf8'),
    head: readFileSync(path.join(context.roots.head, headSource), 'utf8'),
  };
  const closure = (side: Side, slot: string) => {
    const source = side === 'base' ? baseSource : headSource;
    const sites = resolveSlot(context.roots[side], source, codes[side], slot, context.aliases);
    const texts = sites.map(slotClosure);
    return sites.length && texts.every((text) => text !== undefined) ? texts.join('\n') : undefined;
  };
  const sameRules =
    JSON.stringify([pair.base.rules, pair.base.globalRules ?? [], pair.base.gaps]) ===
    JSON.stringify([pair.head.rules, pair.head.globalRules ?? [], pair.head.gaps]);
  for (const entry of plan.cases) {
    if (entry.flags.some((flag) => CALLER_FLAGS.some((prefix) => flag.startsWith(prefix))))
      continue;
    if (!sameRules && !entry.flags.every((flag) => CHAIN_CLEARABLE.has(flag))) continue;
    const left = chainSignature(pair.base, entry.elementIds.base);
    const right = chainSignature(pair.head, entry.elementIds.head);
    if (!left || !right || left.text !== right.text) continue;
    const same = left.slots.every((slot) => {
      const before = closure('base', slot);
      return before !== undefined && before === closure('head', slot);
    });
    if (!same) continue;
    if (!entry.flags.length && !sameRules) continue;
    entry.flags = [];
    entry.evidence = [
      ...(entry.evidence ?? []),
      'STYLE_CHAIN_UNCHANGED',
      ...(sameRules ? ['FILE_RULES_UNCHANGED'] : []),
    ];
  }
};
