import ts from 'typescript';

import { valueIdentifierNodes } from './identifiers';
import type { StyleAdapter } from './types';

export interface ImportedClass {
  expansion: string;
  factories: Map<string, ts.CallExpression>;
  tokens: string[];
}

const MAX_DEPTH = 4;

export const NAMESPACE = '$';

export const importedClassOf = (
  code: string,
  imported: string,
  local: string,
  adapters: StyleAdapter[],
): ImportedClass | undefined => {
  const sf = ts.createSourceFile(
    'module.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const initializers = new Map<string, ts.Expression>();
  const exported = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isExported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        initializers.set(declaration.name.text, declaration.initializer);
        if (isExported) exported.add(declaration.name.text);
      }
  }
  const isFactory = (node: ts.Expression | undefined): node is ts.CallExpression =>
    !!node &&
    ts.isCallExpression(node) &&
    adapters.some((adapter) => adapter.recognizeFactory(node));
  const root = initializers.get(imported);
  if (!exported.has(imported) || !root || isFactory(root)) return undefined;
  const factories = new Map<string, ts.CallExpression>();
  const tokens = new Set<string>();
  const expand = (node: ts.Expression, depth: number): string | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    const start = node.getStart(sf);
    let text = node.getText(sf);
    const visitLiterals = (child: ts.Node) => {
      if (ts.isStringLiteralLike(child))
        child.text.split(/\s+/).forEach((token) => token && tokens.add(token));
      ts.forEachChild(child, visitLiterals);
    };
    visitLiterals(node);
    const replacements: Array<[number, number, string]> = [];
    for (const identifier of valueIdentifierNodes(node)) {
      const name = identifier.text;
      const target = initializers.get(name);
      if (!target) continue;
      let replacement: string | undefined;
      if (isFactory(target)) {
        replacement = `${local}${NAMESPACE}${name}`;
        factories.set(replacement, target);
      } else {
        const inner = expand(target, depth + 1);
        if (inner === undefined) return undefined;
        replacement = `(${inner})`;
      }
      replacements.push([identifier.getStart(sf) - start, identifier.end - start, replacement]);
    }
    for (const [from, to, replacement] of replacements.sort(([a], [b]) => b - a))
      text = text.slice(0, from) + replacement + text.slice(to);
    return text;
  };
  const expansion = expand(root, 0);
  return expansion !== undefined && (factories.size || tokens.size)
    ? { expansion, factories, tokens: [...tokens] }
    : undefined;
};
