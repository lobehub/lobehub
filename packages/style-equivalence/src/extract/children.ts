import ts from 'typescript';

import type { LiteralValue, StyleElement } from './types';

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

export const PLAIN_ATTRIBUTES_UNMODELED = 'PLAIN_ATTRIBUTES_UNMODELED';

const STYLE_PROPS = new Set(['class', 'className', 'style']);

const objectLiteralOf = (expression: ts.ObjectLiteralExpression) => {
  const value: Record<string, LiteralValue> = {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const { name } = property;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return undefined;
    const inner = literalOf(property.initializer);
    if (inner === undefined) return undefined;
    value[name.text] = inner;
  }
  return value;
};

export const literalOf = (expression: ts.Expression): LiteralValue | undefined => {
  if (ts.isParenthesizedExpression(expression)) return literalOf(expression.expression);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  )
    return -Number(expression.operand.text);
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isObjectLiteralExpression(expression)) return objectLiteralOf(expression);
  return undefined;
};

const isElement = (node: ts.Node): node is JsxNode =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);

const openingOf = (node: JsxNode) => (ts.isJsxElement(node) ? node.openingElement : node);

const isIntrinsic = (tag: string) => /^[a-z][\w-]*$/.test(tag);

const directChildren = (node: JsxNode) => {
  const found: JsxNode[] = [];
  const visit = (current: ts.Node) => {
    if (isElement(current)) found.push(current);
    else ts.forEachChild(current, visit);
  };
  if (ts.isJsxElement(node)) node.children.forEach(visit);
  return found;
};

const subtreeTags = (node: JsxNode, ast: ts.SourceFile) => {
  const counts: Record<string, number> = {};
  const components = new Set<string>();
  const visit = (current: ts.Node) => {
    if (isElement(current)) {
      const tag = openingOf(current).tagName.getText(ast);
      if (isIntrinsic(tag)) counts[tag] = (counts[tag] ?? 0) + 1;
      else components.add(tag);
    }
    ts.forEachChild(current, visit);
  };
  if (ts.isJsxElement(node)) node.children.forEach(visit);
  return { components: [...components].sort(), counts };
};

const plainAttributes = (opening: ts.JsxOpeningLikeElement, ast: ts.SourceFile) => {
  const literalProps: Record<string, LiteralValue> = {};
  let opaque = false;
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      opaque = true;
      continue;
    }
    const name = attribute.name.getText(ast);
    const { initializer } = attribute;
    if (!initializer) {
      literalProps[name] = true;
      continue;
    }
    if (ts.isStringLiteral(initializer)) {
      literalProps[name] = initializer.text;
      continue;
    }
    const literal =
      ts.isJsxExpression(initializer) && initializer.expression
        ? literalOf(initializer.expression)
        : undefined;
    if (literal !== undefined) literalProps[name] = literal;
    else if (STYLE_PROPS.has(name)) opaque = true;
  }
  return { literalProps, opaque };
};

export const collectChildren = (
  styled: Map<ts.Node, StyleElement>,
  ast: ts.SourceFile,
  classifyTag: (tag: string) => boolean,
  describe: (tag: string, opening: ts.JsxOpeningLikeElement) => Partial<StyleElement> = () => ({}),
) => {
  const plain: StyleElement[] = [];
  for (const [node, element] of styled) {
    const jsx = node as JsxNode;
    const children = directChildren(jsx).map((child, index) => {
      const known = styled.get(child);
      if (known) return known.id;
      const opening = openingOf(child);
      const tag = opening.tagName.getText(ast);
      const { literalProps, opaque } = plainAttributes(opening, ast);
      const id = `${element.id}/${index}`;
      const real = classifyTag(tag);
      const { components: nested, counts: tags } = subtreeTags(child, ast);
      plain.push({
        bindings: [],
        flags: opaque ? [PLAIN_ATTRIBUTES_UNMODELED] : [],
        id,
        literalProps,
        owner: element.owner,
        parent: element.id,
        ...(real ? { real } : {}),
        slots: [],
        ...(nested.length ? { subtreeComponents: nested } : {}),
        ...(Object.keys(tags).length ? { subtreeTags: tags } : {}),
        tag,
        variables: [],
        ...describe(tag, opening),
      });
      return id;
    });
    if (children.length) element.children = children;
    const { components, counts } = subtreeTags(jsx, ast);
    if (Object.keys(counts).length) element.subtreeTags = counts;
    if (components.length) element.subtreeComponents = components;
  }
  return plain;
};
