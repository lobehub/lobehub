import postcss from 'postcss';
import ts from 'typescript';

import { returnedObject, templateText } from './css';

const PLACEHOLDER = /_I\d+__/;

const templateProperties = (template: ts.TemplateLiteral) => {
  const properties = new Set<string>();
  let readable = true;
  try {
    const root = postcss.parse(templateText(template));
    root.walkDecls((node) => {
      if (PLACEHOLDER.test(node.prop)) readable = false;
      else properties.add(node.prop.toLowerCase());
    });
  } catch {
    return undefined;
  }
  return readable ? [...properties].sort() : undefined;
};

export const templateSlotProperties = (symbol: string, factory: ts.CallExpression) => {
  const object = returnedObject(factory);
  const found: Record<string, string[]> = {};
  for (const property of object?.properties ?? []) {
    if (!ts.isPropertyAssignment(property)) continue;
    const value = property.initializer;
    if (!ts.isTaggedTemplateExpression(value)) continue;
    const properties = templateProperties(value.template);
    if (properties) found[`${symbol}.${property.name.getText()}`] = properties;
  }
  return found;
};

const keyOf = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name)
    ? name.text
    : ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)
      ? name.expression.text
      : undefined;

const kebab = (key: string) =>
  key.startsWith('--') ? key : key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const objectProperties = (object: ts.ObjectLiteralExpression, into: Set<string>): boolean =>
  object.properties.every((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
      return false;
    const key = keyOf(property.name);
    if (key === undefined) return false;
    if (!/^[:@]/.test(key)) {
      into.add(kebab(key));
      return true;
    }
    const nested = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : undefined;
    return !!nested && ts.isObjectLiteralExpression(nested) && objectProperties(nested, into);
  });

const styleObjectOf = (value: ts.Expression) => {
  const node = unwrap(value);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (!ts.isArrowFunction(node) || ts.isBlock(node.body)) return undefined;
  const body = unwrap(node.body);
  return ts.isObjectLiteralExpression(body) ? body : undefined;
};

export const objectSlotProperties = (symbol: string, factory: ts.CallExpression) => {
  const found: Record<string, string[]> = {};
  const [argument] = factory.arguments;
  const object = argument && unwrap(argument);
  if (!object || !ts.isObjectLiteralExpression(object)) return found;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const slot = keyOf(property.name);
    const style = styleObjectOf(property.initializer);
    const properties = new Set<string>();
    if (slot !== undefined && style && objectProperties(style, properties))
      found[`${symbol}.${slot}`] = [...properties].sort();
  }
  return found;
};

const objectConditions = (object: ts.ObjectLiteralExpression, into: Set<string>) => {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = keyOf(property.name);
    if (key?.startsWith(':')) into.add(key);
    const nested = unwrap(property.initializer);
    if (ts.isObjectLiteralExpression(nested)) objectConditions(nested, into);
  }
};

export const objectSlotConditions = (symbol: string, factory: ts.CallExpression) => {
  const found: Record<string, string[]> = {};
  const [argument] = factory.arguments;
  const object = argument && unwrap(argument);
  if (!object || !ts.isObjectLiteralExpression(object)) return found;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const slot = keyOf(property.name);
    const style = styleObjectOf(property.initializer);
    const conditions = new Set<string>();
    if (style) objectConditions(style, conditions);
    if (slot !== undefined && conditions.size) found[`${symbol}.${slot}`] = [...conditions].sort();
  }
  return found;
};
