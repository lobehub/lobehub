import ts from 'typescript';

import { parseRules } from './css';
import { classNamesIn } from './selectors';
import type { TopLevel } from './topLevel';
import type { ExtractOptions, StyleRule } from './types';
import { stylexUnsupported } from './unsupported';

export const memberOf = (node: ts.Identifier, expansion: string) => {
  if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node) return;
  const parsed = ts.createSourceFile('x.ts', `(${expansion});`, ts.ScriptTarget.Latest, true);
  const [statement] = parsed.statements;
  let value = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
  while (value && ts.isParenthesizedExpression(value)) value = value.expression;
  if (!value || !ts.isObjectLiteralExpression(value)) return;
  const name = node.parent.name.text;
  const property = value.properties.find(
    (item): item is ts.PropertyAssignment =>
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name,
  );
  return property?.initializer.getText(parsed);
};

export const collectRules = (
  ast: ts.SourceFile,
  file: string,
  top: TopLevel,
  options: ExtractOptions,
  derived: Map<string, string>,
) => {
  const gaps: string[] = [];
  const rules: StyleRule[] = [];
  const slotProperties: Record<string, string[]> = {};
  const slotConditions: Record<string, string[]> = {};
  const unsupported = stylexUnsupported(top.styleFactories);
  const addFactory = (symbol: string, factory: ts.CallExpression) => {
    for (const adapter of options.adapters)
      if (adapter.recognizeFactory(factory)) {
        rules.push(...(adapter.rulesOf?.(symbol, factory) ?? []));
        Object.assign(slotProperties, adapter.propertiesOf?.(symbol, factory));
        Object.assign(slotConditions, adapter.conditionsOf?.(symbol, factory));
      }
  };
  for (const [symbol, factory] of top.styleFactories) addFactory(symbol, factory);
  const globalClasses = new Set<string>();
  for (const { binding, source } of top.stylesheets) {
    const css = options.readStylesheet?.(file, source);
    if (css === undefined) {
      gaps.push(`STYLESHEET_UNREADABLE:${source}`);
      continue;
    }
    const parsed = parseRules(css);
    if (parsed.error) gaps.push(`STYLESHEET_UNPARSEABLE:${source}`);
    const classes = new Set(parsed.rules.flatMap((rule) => classNamesIn(rule.selector)));
    const owned =
      binding.kind === 'module'
        ? Object.fromEntries([...classes].map((name) => [name, `${binding.symbol}.${name}`]))
        : {};
    if (binding.kind === 'global') classes.forEach((name) => globalClasses.add(name));
    for (const rule of parsed.rules) rules.push({ ...rule, owned, stylesheet: source });
  }
  for (const [local, imported] of top.importedClasses) {
    if (!imported.factories.size && !imported.tokens.some((token) => globalClasses.has(token)))
      continue;
    derived.set(local, imported.expansion);
    for (const [symbol, factory] of imported.factories) {
      top.styleSymbols.add(symbol);
      addFactory(symbol, factory);
    }
  }
  for (const statement of ast.statements)
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || !value || !ts.isStringLiteralLike(value))
          continue;
        if (value.text.split(/\s+/).some((token) => globalClasses.has(token)))
          derived.set(declaration.name.text, JSON.stringify(value.text));
      }
  return { gaps, globalClasses, rules, slotConditions, slotProperties, unsupported };
};
