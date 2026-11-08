import postcss, { type AtRule, type Container, type Declaration, type Rule } from 'postcss';
import ts from 'typescript';

import type { StyleRule } from './types';

export const SELF = '__self__';
const PLACEHOLDER = /^__I\d+__$/;

const conditionsOf = (node: Rule) => {
  const conditions: string[] = [];
  for (let parent: Container | undefined = node; parent; parent = parent.parent as Container) {
    if (parent.type === 'atrule')
      conditions.unshift(`@${(parent as AtRule).name} ${(parent as AtRule).params}`);
    if (parent.type === 'rule' && PLACEHOLDER.test((parent as Rule).selector.trim()))
      conditions.unshift((parent as Rule).selector.trim());
    if (parent.type === 'root') break;
  }
  return conditions;
};

const fullSelector = (rule: Rule, rootSelector: string | undefined): string | undefined => {
  const parent = rule.parent;
  const parentSelector =
    parent && parent.type === 'rule' ? fullSelector(parent as Rule, rootSelector) : rootSelector;
  if (PLACEHOLDER.test(rule.selector.trim())) return parentSelector;
  if (parentSelector === undefined) return rule.selector;
  return rule.selector
    .split(',')
    .map((part) =>
      part.includes('&')
        ? part.replaceAll('&', parentSelector)
        : `${parentSelector} ${part.trim()}`,
    )
    .join(', ');
};

const declarationsOf = (rule: Rule) =>
  (rule.nodes ?? [])
    .filter((node): node is Declaration => node.type === 'decl')
    .map(
      (node) =>
        `${node.prop.toLowerCase()}: ${node.value.replaceAll(/\s+/g, ' ').trim()}${node.important ? ' !important' : ''}`,
    );

export const parseRules = (css: string, rootSelector?: string) => {
  const rules: Array<{ conditions: string[]; declarations: string[]; selector: string }> = [];
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return { error: true, rules };
  }
  root.walkRules((rule) => {
    const selector = fullSelector(rule, rootSelector);
    if (selector && selector !== rootSelector)
      rules.push({ conditions: conditionsOf(rule), declarations: declarationsOf(rule), selector });
  });
  return { error: false, rules };
};

export const templateText = (template: ts.TemplateLiteral) => {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  let text = template.head.text;
  template.templateSpans.forEach((span, index) => {
    text += `__I${index}__${span.literal.text}`;
  });
  return text;
};

export const returnedObject = (factory: ts.CallExpression) => {
  const callback = factory.arguments[0];
  if (!callback) return undefined;
  if (ts.isObjectLiteralExpression(callback)) return callback;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return undefined;
  let body: ts.Node | undefined = callback.body;
  if (ts.isBlock(body)) body = body.statements.find(ts.isReturnStatement)?.expression;
  while (body && ts.isParenthesizedExpression(body)) body = body.expression;
  return body && ts.isObjectLiteralExpression(body) ? body : undefined;
};

const topLevelConstants = (sf: ts.SourceFile) => {
  const constants = new Map<string, ts.Expression>();
  for (const statement of sf.statements)
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          constants.set(declaration.name.text, declaration.initializer);
  return constants;
};

const constantText = (
  node: ts.Expression,
  constants: Map<string, ts.Expression>,
  depth = 0,
): string | undefined => {
  if (depth > 4) return undefined;
  if (ts.isParenthesizedExpression(node)) return constantText(node.expression, constants, depth);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return String(Number(node.getText().replaceAll('_', '')));
  if (!ts.isIdentifier(node)) return undefined;
  const target = constants.get(node.text);
  return target && constantText(target, constants, depth + 1);
};

export const importAliases = (sf: ts.SourceFile, imported: string) => {
  const aliases = new Map<string, string>();
  for (const statement of sf.statements) {
    const named = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    if (named && ts.isNamedImports(named))
      for (const element of named.elements)
        if ((element.propertyName ?? element.name).text === imported)
          aliases.set(element.name.text, imported);
  }
  return aliases;
};

export const templateSlotRules = (symbol: string, factory: ts.CallExpression): StyleRule[] => {
  const object = returnedObject(factory);
  if (!object) return [];
  const constants = topLevelConstants(factory.getSourceFile());
  const tokenAliases = importAliases(factory.getSourceFile(), 'cssVar');
  const rules: StyleRule[] = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const value = property.initializer;
    if (!ts.isTaggedTemplateExpression(value)) continue;
    const slot = `${symbol}.${property.name.getText()}`;
    const spans = ts.isTemplateExpression(value.template) ? value.template.templateSpans : [];
    const interpolations = spans.map((span) => {
      const { expression } = span;
      const alias =
        ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
          ? tokenAliases.get(expression.expression.text)
          : undefined;
      if (alias && ts.isPropertyAccessExpression(expression))
        return `${alias}.${expression.name.text}`;
      return expression.getText().replaceAll(/\s+/g, ' ').trim();
    });
    const folded = spans.map((span) => constantText(span.expression, constants) ?? null);
    for (const rule of parseRules(templateText(value.template), `.${SELF}`).rules)
      rules.push({
        ...rule,
        ...(interpolations.length ? { interpolations } : {}),
        ...(folded.some((item) => item !== null) ? { interpolationValues: folded } : {}),
        owned: { [SELF]: slot },
        slot,
      });
  }
  return rules;
};
