import ts from 'typescript';

import { importAliases, parseRules, templateText } from './css';
import type { StyleRule } from './types';

const GLOBAL_FACTORIES = new Set(['createGlobalStyle', 'injectGlobal']);
const MAX_DEPTH = 4;

type ReadModule = (specifier: string) => string | undefined;

interface Scope {
  constants: Map<string, ts.Expression>;
  imports: Map<string, { imported: string; specifier: string }>;
  readModule?: ReadModule;
  sf: ts.SourceFile;
}

const scopeOf = (sf: ts.SourceFile, readModule?: ReadModule): Scope => {
  const constants = new Map<string, ts.Expression>();
  const imports = new Map<string, { imported: string; specifier: string }>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const element of named.elements)
          imports.set(element.name.text, {
            imported: (element.propertyName ?? element.name).text,
            specifier: statement.moduleSpecifier.text,
          });
    }
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          constants.set(declaration.name.text, declaration.initializer);
  }
  return { constants, imports, readModule, sf };
};

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    ? unwrap(node.expression)
    : node;

const lookup = (name: string, scope: Scope, depth: number) => {
  const local = scope.constants.get(name);
  if (local) return { node: local, scope };
  const imported = scope.imports.get(name);
  const code = imported && scope.readModule?.(imported.specifier);
  if (!imported || !code || depth > MAX_DEPTH) return undefined;
  const sf = ts.createSourceFile('module.ts', code, ts.ScriptTarget.Latest, true);
  const next = scopeOf(sf);
  const node = next.constants.get(imported.imported);
  return node && { node, scope: next };
};

export const foldConstant = (raw: ts.Expression, scope: Scope, depth = 0): string | undefined => {
  if (depth > MAX_DEPTH) return undefined;
  const node = unwrap(raw);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return String(Number(node.getText().replaceAll('_', '')));
  if (ts.isIdentifier(node)) {
    const found = lookup(node.text, scope, depth);
    return found && foldConstant(found.node, found.scope, depth + 1);
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const found = lookup(node.expression.text, scope, depth);
    const object = found && unwrap(found.node);
    if (!object || !ts.isObjectLiteralExpression(object)) return undefined;
    const property = object.properties.find(
      (item): item is ts.PropertyAssignment =>
        ts.isPropertyAssignment(item) &&
        (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
        item.name.text === node.name.text,
    );
    return property && foldConstant(property.initializer, found.scope, depth + 1);
  }
  return undefined;
};

const isGlobalFactory = (tag: ts.Expression) =>
  ts.isIdentifier(tag) && GLOBAL_FACTORIES.has(tag.text);

export const globalStyleRules = (sf: ts.SourceFile, readModule?: ReadModule): StyleRule[] => {
  const scope = scopeOf(sf, readModule);
  const tokenAliases = importAliases(sf, 'cssVar');
  const rules: StyleRule[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node) && isGlobalFactory(node.tag)) {
      const spans = ts.isTemplateExpression(node.template) ? node.template.templateSpans : [];
      const interpolations = spans.map(({ expression }) => {
        const alias =
          ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
            ? tokenAliases.get(expression.expression.text)
            : undefined;
        if (alias && ts.isPropertyAccessExpression(expression))
          return `${alias}.${expression.name.text}`;
        return expression.getText(sf).replaceAll(/\s+/g, ' ').trim();
      });
      const folded = spans.map((span) => foldConstant(span.expression, scope) ?? null);
      const parsed = parseRules(templateText(node.template));
      const symbol = ts.isVariableDeclaration(node.parent)
        ? node.parent.name.getText(sf)
        : 'global';
      for (const rule of parsed.error ? [] : parsed.rules)
        rules.push({
          ...rule,
          ...(interpolations.length ? { interpolations } : {}),
          ...(folded.some((item) => item !== null) ? { interpolationValues: folded } : {}),
          owned: {},
          stylesheet: `global:${symbol}`,
        });
      if (parsed.error)
        rules.push({ conditions: [], owned: {}, selector: '', stylesheet: `unparsed:${symbol}` });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return rules;
};
