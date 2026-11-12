import ts from 'typescript';

import { aliasDeclaration, aliasOf, constInitializer } from './aliases';
import { booleanAttribute, isStateAttribute } from './attributes';
import { collectChildren, literalOf } from './children';
import { localCondition, renderGuards } from './constraints';
import { parseRules } from './css';
import { applicationIn, componentOfStatement, forwardsOf } from './forward';
import { globalStyleRules } from './globalStyles';
import {
  declaredLocally,
  isJsxNode,
  literalText,
  mergeKinds,
  usageKinds,
  valueIdentifierNodes,
} from './identifiers';
import { applyRenderedStyle, renderedStyle, slotStylesOf } from './renderedStyle';
import { classifyRules, classNamesIn, foreignClassNames } from './selectors';
import { collectTables } from './tables';
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
import { stylexUnsupported } from './unsupported';

export type * from './types';

export const GLOBALS = new Set([
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

const CLASS_PROPS = new Set(['...', 'className', 'classNames']);

const ownerOf = (statement: ts.Statement, ast: ts.SourceFile) => {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.map((d) => d.name.getText(ast)).join(',');
  if (ts.isFunctionDeclaration(statement)) return statement.name?.text ?? 'default';
  if (ts.isExportAssignment(statement)) return 'default';
  return `statement@${ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1}`;
};

export const extractFile = (
  code: string,
  file: string,
  options: ExtractOptions,
): FileExtraction => {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const top = collectTopLevel(ast, options.adapters, (specifier) =>
    options.readModule?.(file, specifier),
  );
  const markers = new Set(options.adapters.flatMap((adapter) => adapter.markerIdentifiers));
  const layout = new Set(options.layoutComponents);
  const isReal = (tag: string) => {
    const component = options.realComponents?.[tag];
    const statement = top.importOf.get(tag);
    if (!component || !statement || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
    if (statement.moduleSpecifier.text !== component.source) return false;
    const named = statement.importClause?.namedBindings;
    return (
      !!named &&
      ts.isNamedImports(named) &&
      named.elements.some(
        (element) =>
          element.name.text === tag && (element.propertyName ?? element.name).text === tag,
      )
    );
  };
  const derived = new Map<string, string>();
  const isStyleName = (name: string) => top.styleSymbols.has(name) || markers.has(name);
  const referencesStyle = (node: ts.Node, prop?: string) =>
    valueIdentifierNodes(node, { skipJsx: true }).some(
      (identifier) =>
        isStyleName(identifier.text) ||
        !!aliasOf(identifier, top.styleSymbols) ||
        (CLASS_PROPS.has(prop ?? '') && derived.has(identifier.text)),
    );
  const styledConst = (expression: ts.Expression, prop: string) => {
    if (!ts.isIdentifier(expression) || referencesStyle(expression, prop)) return expression;
    const initializer = constInitializer(expression);
    return initializer && !ts.isIdentifier(initializer) && referencesStyle(initializer, prop)
      ? initializer
      : expression;
  };
  const slotsOf = (node: ts.Node) => {
    const slots = new Set<string>();
    const visit = (current: ts.Node) => {
      if (isJsxNode(current)) return;
      if (
        ts.isPropertyAccessExpression(current) &&
        ts.isIdentifier(current.expression) &&
        (top.styleSymbols.has(current.expression.text) ||
          aliasOf(current.expression, top.styleSymbols))
      )
        slots.add(
          `${top.styleSymbols.has(current.expression.text) ? current.expression.text : aliasOf(current.expression, top.styleSymbols)}.${current.name.text}`,
        );
      ts.forEachChild(current, visit);
    };
    if (!isJsxNode(node)) ts.forEachChild(node, visit);
    if (ts.isPropertyAccessExpression(node)) visit(node);
    return slots;
  };

  const gaps: string[] = [];
  const rules: StyleRule[] = [];
  const slotProperties: Record<string, string[]> = {};
  const slotConditions: Record<string, string[]> = {};
  const unsupported = stylexUnsupported(top.styleFactories);
  for (const [symbol, factory] of top.styleFactories)
    for (const adapter of options.adapters)
      if (adapter.recognizeFactory(factory)) {
        rules.push(...(adapter.rulesOf?.(symbol, factory) ?? []));
        Object.assign(slotProperties, adapter.propertiesOf?.(symbol, factory));
        Object.assign(slotConditions, adapter.conditionsOf?.(symbol, factory));
      }
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
      for (const adapter of options.adapters)
        if (adapter.recognizeFactory(factory)) {
          rules.push(...(adapter.rulesOf?.(symbol, factory) ?? []));
          Object.assign(slotProperties, adapter.propertiesOf?.(symbol, factory));
          Object.assign(slotConditions, adapter.conditionsOf?.(symbol, factory));
        }
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
  const memberOf = (node: ts.Identifier, expansion: string) => {
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
  const expandedOf = (expression: ts.Expression) => {
    const start = expression.getStart(ast);
    let text = expression.getText(ast);
    const found = valueIdentifierNodes(expression, { skipJsx: true })
      .filter((node) => derived.has(node.text) && !declaredLocally(node))
      .sort((a, b) => b.getStart(ast) - a.getStart(ast));
    if (!found.length) return undefined;
    for (const node of found) {
      const member = memberOf(node, derived.get(node.text)!);
      const target = member ? node.parent : node;
      text = `${text.slice(0, target.getStart(ast) - start)}(${member ?? derived.get(node.text)})${text.slice(target.end - start)}`;
    }
    const parsed = ts.createSourceFile(
      'x.tsx',
      `(${text});`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const [statement] = parsed.statements;
    return statement && ts.isExpressionStatement(statement)
      ? { node: statement.expression, text }
      : undefined;
  };
  const usedGlobal = new Set<string>();
  const globalTokensIn = (node: ts.Node) => {
    const tokens = new Set<string>();
    const visit = (current: ts.Node) => {
      const text = literalText(current);
      if (text !== undefined)
        for (const token of text.split(/\s+/)) if (globalClasses.has(token)) tokens.add(token);
      ts.forEachChild(current, visit);
    };
    visit(node);
    return tokens;
  };

  const elements: StyleElement[] = [];
  const styled = new Map<ts.Node, StyleElement>();
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
      const attributes: Record<string, string> = {};
      const attributeNames: ts.Identifier[] = [];
      let iconNode: ts.Node | undefined;
      const slots = new Set<string>();
      const expressions: ts.Expression[] = [];
      const expansions: ts.Expression[] = [];
      const bindingOf = (expression: ts.Expression, prop: string, spread: boolean) => {
        bound.add(expression);
        expressions.push(expression);
        slotsOf(expression).forEach((slot) => slots.add(slot));
        for (const token of globalTokensIn(expression)) {
          usedGlobal.add(token);
          slots.add(`global.${token}`);
        }
        const expanded = expandedOf(expression);
        if (expanded) {
          expansions.push(expanded.node);
          slotsOf(expanded.node).forEach((slot) => slots.add(slot));
          for (const token of globalTokensIn(expanded.node)) {
            usedGlobal.add(token);
            slots.add(`global.${token}`);
          }
        }
        bindings.push({
          expr: expression.getText(ast),
          ...(expanded ? { expansion: expanded.text } : {}),
          prop,
          spread,
        });
      };
      let runtimeStyle: string | undefined;
      let styleExpr: string | undefined;
      let inlineStyle: ReturnType<typeof renderedStyle>;
      let lastStyle = -1;
      let lastForeign = -1;
      for (const [position, attribute] of opening.attributes.properties.entries()) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          const spread = styledConst(attribute.expression, '...');
          if (!referencesStyle(spread, '...')) {
            lastForeign = position;
            continue;
          }
          lastStyle = position;
          bindingOf(spread, '...', true);
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
        if (name === 'icon' && isJsxNode(expression)) iconNode = expression;
        const slotStyles = slotStylesOf(name, opening.tagName.getText(ast), expression, top);
        if (referencesStyle(expression, name) || slotStyles) {
          bindingOf(expression, name, false);
          if (slotStyles && ts.isIdentifier(expression)) bindings.at(-1)!.expansion = slotStyles;
          continue;
        }
        const literal = literalOf(expression);
        if (literal !== undefined) literalProps[name] = literal;
        else if (
          isStateAttribute(name) &&
          ts.isIdentifier(expression) &&
          !GLOBALS.has(expression.text) &&
          booleanAttribute(code, name)
        ) {
          attributes[name] = expression.text;
          attributeNames.push(expression);
        } else if (
          name === 'style' &&
          !(ts.isIdentifier(expression) && GLOBALS.has(expression.text))
        ) {
          styleExpr = expression.getText(ast).replaceAll(/\s+/g, ' ');
          inlineStyle = renderedStyle(expression, top.importOf, GLOBALS);
          lastStyle = position;
          if (ts.isIdentifier(expression)) runtimeStyle = expression.text;
        }
      }
      let current = parent;
      if (bindings.length) {
        const tag = opening.tagName.getText(ast);
        const names = new Set<string>();
        const used = new Map<string, string>();
        const derivedConditions: Record<string, string> = {};
        for (const expression of expressions)
          for (const node of valueIdentifierNodes(expression, { skipJsx: true })) {
            const name = node.text;
            if (GLOBALS.has(name)) continue;
            const alias = aliasOf(node, top.styleSymbols);
            if (alias) {
              used.set(name, alias);
              continue;
            }
            const condition = localCondition(node);
            if (condition) derivedConditions[name] = condition;
            if (declaredLocally(node)) names.add(name);
            else if (markers.has(name)) top.require(name);
            else if (!top.styleSymbols.has(name) && !top.require(name)) names.add(name);
          }
        const kinds = new Map<string, VariableKind[]>();
        for (const expression of expressions)
          for (const [name, list] of usageKinds(expression, names))
            kinds.set(name, [...(kinds.get(name) ?? []), ...list]);
        if (inlineStyle) applyRenderedStyle(inlineStyle, top.require, names, kinds);
        for (const node of attributeNames)
          if (
            declaredLocally(node) ||
            (!top.styleSymbols.has(node.text) && !top.require(node.text))
          ) {
            names.add(node.text);
            kinds.set(node.text, [...(kinds.get(node.text) ?? []), 'boolean']);
          }
        const real = isReal(tag);
        const guards = renderGuards(node);
        if (layout.has(tag) || real) top.require(tag);
        const id = `${owner}#${ordinal++}`;
        const tokens = new Set<string>();
        const collectTokens = (node: ts.Node) => {
          literalText(node)
            ?.split(/\s+/)
            .forEach((token) => token && tokens.add(token));
          ts.forEachChild(node, collectTokens);
        };
        expressions.forEach(collectTokens);
        expansions.forEach(collectTokens);
        for (const binding of bindings)
          if (binding.prop === 'className' && binding.expr.startsWith('"'))
            (JSON.parse(binding.expr) as string).split(/\s+/).forEach((token) => tokens.add(token));
        classTokens.set(id, tokens);
        const element: StyleElement = {
          bindings,
          flags: [],
          id,
          literalProps,
          ...(Object.keys(attributes).length ? { attributes } : {}),
          ...(Object.keys(derivedConditions).length ? { derived: derivedConditions } : {}),
          ...(guards.length ? { guards } : {}),
          ...(inlineStyle ? { inlineStyle: inlineStyle.text } : {}),
          owner,
          parent,
          ...(real ? { real } : {}),
          ...(runtimeStyle && !opening.attributes.properties.some(ts.isJsxSpreadAttribute)
            ? { runtimeStyle }
            : {}),
          slots: [...slots].sort(),
          ...(styleExpr ? { styleExpr } : {}),
          ...(opening.attributes.properties.filter(ts.isJsxSpreadAttribute).length >
          bindings.filter((binding) => binding.spread).length
            ? { foreignSpread: true }
            : {}),
          ...(lastForeign > lastStyle && lastStyle >= 0 ? { spreadAfterStyle: true } : {}),
          ...(used.size ? { aliases: Object.fromEntries([...used].sort()) } : {}),
          tag,
          variables: [...names].sort().map((name) => ({
            kind: mergeKinds(kinds.get(name) ?? ['unknown']),
            name,
          })),
        };
        const forwards = forwardsOf(tag, bindings, file, top.importOf, options);
        if (forwards.length) element.forwards = forwards;
        const [binding] = bindings;
        const [variable] = element.variables;
        if (bindings.length === 1 && element.variables.length === 1 && !binding.spread) {
          const fn = componentOfStatement(ast, statement);
          const found = fn && applicationIn(fn, variable.name, ast);
          if (found && 'element' in found && found.element === node)
            element.forwardedParam = variable.name;
        }
        elements.push(element);
        styled.set(node, element);
        current = id;
      }
      if (ts.isJsxElement(node)) {
        ts.forEachChild(node.openingElement, (child) => visit(child, parent));
        node.children.forEach((child) => visit(child, current));
      } else ts.forEachChild(node, (child) => visit(child, parent));
      const host = styled.get(node);
      if (host && iconNode) host.iconElement = styled.get(iconNode)?.id ?? true;
    };
    visit(statement, undefined);
  }

  const plain = collectChildren(styled, ast, (tag) => {
    const real = isReal(tag);
    if (layout.has(tag) || real) top.require(tag);
    return real;
  });

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
        const aliased =
          ts.isVariableDeclaration(parent) &&
          parent.initializer === node &&
          aliasDeclaration(parent, top.styleSymbols) === node.text;
        if (!nameOnly && !aliased)
          outsideReferences.push(
            `${node.text}@${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}`,
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }

  const globalOwned = Object.fromEntries([...usedGlobal].map((name) => [name, `global.${name}`]));
  const ownersOf = (matches: (element: (typeof elements)[number]) => boolean) =>
    new Set(elements.filter(matches).map((element) => element.owner));
  const isLocal = (name: string, slots: string[]) => {
    const carriers = ownersOf((element) => classTokens.get(element.id)?.has(name) ?? false);
    const users = ownersOf((element) => element.slots.some((slot) => slots.includes(slot)));
    return carriers.size > 0 && [...carriers].every((owner) => users.has(owner));
  };
  const flags = classifyRules(rules, globalOwned, isLocal);
  const foreign = foreignClassNames(rules, globalOwned, isLocal);
  for (const element of elements) {
    const found = new Set(element.slots.flatMap((slot) => [...(flags.get(slot) ?? [])]));
    if ([...(classTokens.get(element.id) ?? [])].some((token) => foreign.has(token)))
      found.add('CROSS_COMPONENT');
    element.flags = [...found].sort();
  }

  const globalRules = globalStyleRules(ast, (specifier) => options.readModule?.(file, specifier));
  const literalClasses = new Set<string>();
  const collectLiterals = (node: ts.Node) => {
    literalText(node)
      ?.split(/\s+/)
      .forEach((token) => /^[a-z][\w-]*-[\w-]+$/i.test(token) && literalClasses.add(token));
    ts.forEachChild(node, collectLiterals);
  };
  collectLiterals(ast);
  return {
    elements,
    file,
    gaps,
    ...(globalRules.length ? { globalRules } : {}),
    ...(literalClasses.size ? { literalClasses: [...literalClasses].sort() } : {}),
    ...(Object.keys(unsupported).length ? { unsupported } : {}),
    outsideReferences,
    ...(plain.length ? { plain } : {}),
    prelude: top.prelude(),
    rules,
    ...(Object.keys(slotConditions).length ? { slotConditions } : {}),
    slotProperties,
    styleSymbols: [...top.styleSymbols].sort(),
    tables: collectTables(ast),
  };
};
