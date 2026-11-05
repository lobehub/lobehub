import postcss, { type AtRule, type Container, type Declaration, type Rule } from 'postcss';
import ts from 'typescript';

import type { StyleRule } from './types';

export const SELF = '__self__';
const PLACEHOLDER = /^__I\d+__$/;

const conditionsOf = (node: Rule) => {
  const conditions: string[] = [];
  for (
    let parent: Container | undefined = node.parent;
    parent;
    parent = parent.parent as Container
  ) {
    if (parent.type === 'atrule')
      conditions.unshift(`@${(parent as AtRule).name} ${(parent as AtRule).params}`);
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

export const templateSlotRules = (symbol: string, factory: ts.CallExpression): StyleRule[] => {
  const object = returnedObject(factory);
  if (!object) return [];
  const rules: StyleRule[] = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const value = property.initializer;
    if (!ts.isTaggedTemplateExpression(value)) continue;
    const slot = `${symbol}.${property.name.getText()}`;
    for (const rule of parseRules(templateText(value.template), `.${SELF}`).rules)
      rules.push({ ...rule, owned: { [SELF]: slot }, slot });
  }
  return rules;
};
