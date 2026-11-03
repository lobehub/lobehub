import ts from 'typescript';

import { parseRules } from './css';
import { isJsxNode, mergeKinds, usageKinds, valueIdentifiers } from './identifiers';
import { classifyRules, classNamesIn, foreignClassNames } from './selectors';
import { collectTopLevel } from './topLevel';
import type {
  ExtractOptions,
  FileExtraction,
  LiteralValue,
  StyleBinding,
  StyleElement,
  StyleRule,
  VariableKind,
} from './types';

export type * from './types';

const GLOBALS = new Set([
  'Array',
  'Boolean',
  'JSON',
  'Math',
  'Number',
  'Object',
  'String',
  'console',
  'document',
  'false',
  'null',
  'true',
  'undefined',
  'window',
]);

const ownerOf = (statement: ts.Statement, ast: ts.SourceFile) => {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.map((d) => d.name.getText(ast)).join(',');
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text ?? 'default';
  if (ts.isExportAssignment(statement)) return 'default';
  return `statement@${ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1}`;
};

const literalOf = (expression: ts.Expression): LiteralValue | undefined => {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
};

export const extractFile = (
  code: string,
  file: string,
  options: ExtractOptions,
): FileExtraction => {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const top = collectTopLevel(ast, options.adapters);
  const markers = new Set(options.adapters.flatMap((adapter) => adapter.markerIdentifiers));
  const layout = new Set(options.layoutComponents);
  const isStyleName = (name: string) => top.styleSymbols.has(name) || markers.has(name);
  const referencesStyle = (node: ts.Node) =>
    [...valueIdentifiers(node, { skipJsx: true })].some(isStyleName);
  const slotsOf = (node: ts.Node) => {
    const slots = new Set<string>();
    const visit = (current: ts.Node) => {
      if (isJsxNode(current)) return;
      if (
        ts.isPropertyAccessExpression(current) &&
        ts.isIdentifier(current.expression) &&
        top.styleSymbols.has(current.expression.text)
      )
        slots.add(`${current.expression.text}.${current.name.text}`);
      ts.forEachChild(current, visit);
    };
    if (!isJsxNode(node)) ts.forEachChild(node, visit);
    if (ts.isPropertyAccessExpression(node)) visit(node);
    return slots;
  };

  const gaps: string[] = [];
  const rules: StyleRule[] = [];
  for (const [symbol, factory] of top.styleFactories)
    for (const adapter of options.adapters)
      if (adapter.recognizeFactory(factory))
        rules.push(...(adapter.rulesOf?.(symbol, factory) ?? []));
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
    for (const rule of parsed.rules) rules.push({ ...rule, owned });
  }
  const usedGlobal = new Set<string>();

  const elements: StyleElement[] = [];
  const classTokens = new Map<string, Set<string>>();
  const bound = new Set<ts.Node>();

  for (const statement of ast.statements) {
    if (top.keptStatements.has(statement) || ts.isImportDeclaration(statement)) continue;
    const owner = ownerOf(statement, ast);
    let ordinal = 0;
    const visit = (node: ts.Node, parent: string | undefined): void => {
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) {
        ts.forEachChild(node, (child) => visit(child, parent));
        return;
      }
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const bindings: StyleBinding[] = [];
      const literalProps: Record<string, LiteralValue> = {};
      const slots = new Set<string>();
      const expressions: ts.Expression[] = [];
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          if (!referencesStyle(attribute.expression)) continue;
          bound.add(attribute.expression);
          expressions.push(attribute.expression);
          bindings.push({ expr: attribute.expression.getText(ast), prop: '...', spread: true });
          slotsOf(attribute.expression).forEach((slot) => slots.add(slot));
          continue;
        }
        const name = attribute.name.getText(ast);
        const initializer =
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression &&
          (ts.isStringLiteral(attribute.initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(attribute.initializer.expression))
            ? ts.factory.createStringLiteral(attribute.initializer.expression.text)
            : attribute.initializer;
        if (!initializer) {
          literalProps[name] = true;
          continue;
        }
        if (ts.isStringLiteral(initializer)) {
          const matched =
            name === 'className'
              ? initializer.text.split(/\s+/).filter((token) => globalClasses.has(token))
              : [];
          if (matched.length) {
            bindings.push({ expr: JSON.stringify(initializer.text), prop: name, spread: false });
            matched.forEach((token) => {
              usedGlobal.add(token);
              slots.add(`global.${token}`);
            });
            continue;
          }
          literalProps[name] = initializer.text;
          continue;
        }
        if (!ts.isJsxExpression(initializer) || !initializer.expression) continue;
        const expression = initializer.expression;
        if (referencesStyle(expression)) {
          bound.add(expression);
          expressions.push(expression);
          bindings.push({ expr: expression.getText(ast), prop: name, spread: false });
          slotsOf(expression).forEach((slot) => slots.add(slot));
          continue;
        }
        const literal = literalOf(expression);
        if (literal !== undefined) literalProps[name] = literal;
      }
      let current = parent;
      if (bindings.length) {
        const tag = opening.tagName.getText(ast);
        const names = new Set<string>();
        for (const expression of expressions)
          for (const name of valueIdentifiers(expression, { skipJsx: true })) {
            if (GLOBALS.has(name)) continue;
            if (markers.has(name)) top.require(name);
            else if (!top.styleSymbols.has(name) && !top.require(name)) names.add(name);
          }
        const kinds = new Map<string, VariableKind[]>();
        for (const expression of expressions)
          for (const [name, list] of usageKinds(expression, names))
            kinds.set(name, [...(kinds.get(name) ?? []), ...list]);
        if (layout.has(tag)) top.require(tag);
        const id = `${owner}#${ordinal++}`;
        const tokens = new Set<string>();
        const collectTokens = (node: ts.Node) => {
          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
            node.text.split(/\s+/).forEach((token) => token && tokens.add(token));
          ts.forEachChild(node, collectTokens);
        };
        expressions.forEach(collectTokens);
        for (const binding of bindings)
          if (binding.prop === 'className' && binding.expr.startsWith('"'))
            (JSON.parse(binding.expr) as string).split(/\s+/).forEach((token) => tokens.add(token));
        classTokens.set(id, tokens);
        elements.push({
          bindings,
          flags: [],
          id,
          literalProps,
          owner,
          parent,
          slots: [...slots].sort(),
          tag,
          variables: [...names].sort().map((name) => ({
            kind: mergeKinds(kinds.get(name) ?? ['unknown']),
            name,
          })),
        });
        current = id;
      }
      if (ts.isJsxElement(node)) {
        ts.forEachChild(node.openingElement, (child) => visit(child, parent));
        node.children.forEach((child) => visit(child, current));
      } else ts.forEachChild(node, (child) => visit(child, parent));
    };
    visit(statement, undefined);
  }

  const outsideReferences: string[] = [];
  for (const statement of ast.statements) {
    if (top.keptStatements.has(statement) || ts.isImportDeclaration(statement)) continue;
    const visit = (node: ts.Node) => {
      if (bound.has(node)) return;
      if (ts.isIdentifier(node) && top.styleSymbols.has(node.text)) {
        const parent = node.parent;
        const nameOnly =
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node) ||
          (ts.isJsxAttribute(parent) && parent.name === node);
        if (!nameOnly)
          outsideReferences.push(
            `${node.text}@${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`,
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }

  const globalOwned = Object.fromEntries([...usedGlobal].map((name) => [name, `global.${name}`]));
  const flags = classifyRules(rules, globalOwned);
  const foreign = foreignClassNames(rules, globalOwned);
  for (const element of elements) {
    const found = new Set(element.slots.flatMap((slot) => [...(flags.get(slot) ?? [])]));
    if ([...(classTokens.get(element.id) ?? [])].some((token) => foreign.has(token)))
      found.add('CROSS_COMPONENT');
    element.flags = [...found].sort();
  }

  return {
    elements,
    file,
    gaps,
    outsideReferences,
    prelude: top.prelude(),
    rules,
    styleSymbols: [...top.styleSymbols].sort(),
  };
};
