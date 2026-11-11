import ts from 'typescript';

import {
  GLOBALS,
  type LiteralValue,
  type RealComponent,
  type VariableKind,
  type VariableUse,
} from '../extract';
import { literalOf } from '../extract/children';
import { mergeKinds, usageKinds, valueIdentifierNodes } from '../extract/identifiers';
import { parseSource } from './declarations';

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const dedent = (text: string) => {
  const [first, ...rest] = text.split('\n');
  const indents = rest
    .filter((line) => line.trim())
    .map((line) => line.length - line.trimStart().length);
  const common = indents.length ? Math.min(...indents) : 0;
  return [first, ...rest.map((line) => line.slice(common))].join('\n');
};

const ownerNode = (sf: ts.SourceFile, owner: string) =>
  sf.statements.find((statement) => {
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === owner;
    if (ts.isClassDeclaration(statement)) return statement.name?.text === owner;
    return (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === owner,
      )
    );
  });

const openingsOf = (code: string, owner: string, tag: string) => {
  const sf = parseSource(code);
  const root = ownerNode(sf, owner);
  const found: Opening[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sf) === tag
    )
      found.push(node);
    ts.forEachChild(node, visit);
  };
  if (root) visit(root);
  return {
    openings: found.map((node) => ({
      attributes: node.attributes.getText(sf).replaceAll(/\s+/g, ''),
      node,
      text: dedent(node.getText(sf)),
    })),
    sf,
  };
};

export interface CounterpartInput {
  expr: string;
  from: string;
  owner: string;
  tag: string;
  to: string;
}

const counterpartOpening = ({ expr, from, owner, tag, to }: CounterpartInput) => {
  const { openings: others, sf } = openingsOf(to, owner, tag);
  if (!others.length) return undefined;
  const needle = expr.replaceAll(/\s+/g, '');
  const mine = openingsOf(from, owner, tag).openings;
  const index = mine.findIndex((opening) => opening.attributes.includes(needle));
  if (index !== -1 && mine.length === others.length) return { ...others[index], sf };
  return others.length === 1 ? { ...others[0], sf } : undefined;
};

export const counterpartOf = (input: CounterpartInput) => counterpartOpening(input)?.text;

export interface CounterpartLeaf {
  inlineStyle?: string;
  literalProps: Record<string, LiteralValue>;
  props?: string;
  real?: true;
  tag: string;
  variables: VariableUse[];
}

const importedFrom = (sf: ts.SourceFile, tag: string, source: string) =>
  sf.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === source &&
      !!statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) =>
          element.name.text === tag && (element.propertyName ?? element.name).text === tag,
      ),
  );

export const counterpartLeafOf = (
  input: CounterpartInput & { real?: Record<string, RealComponent> },
): CounterpartLeaf | undefined => {
  const opening = counterpartOpening(input);
  if (!opening) return undefined;
  const { node, sf } = opening;
  const literalProps: Record<string, LiteralValue> = {};
  const props: string[] = [];
  const expressions: ts.Expression[] = [];
  let inlineStyle: string | undefined;
  for (const attribute of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) continue;
    const name = attribute.name.getText(sf);
    const initializer = attribute.initializer;
    if (!initializer) {
      literalProps[name] = true;
      continue;
    }
    if (ts.isStringLiteral(initializer)) {
      literalProps[name] = initializer.text;
      continue;
    }
    if (!ts.isJsxExpression(initializer) || !initializer.expression) continue;
    const expression = initializer.expression;
    const literal = literalOf(expression);
    if (literal !== undefined) {
      literalProps[name] = literal;
      continue;
    }
    expressions.push(expression);
    const text = expression.getText(sf).replaceAll(/\s+/g, ' ');
    if (name === 'style') inlineStyle = text;
    else props.push(`${JSON.stringify(name)}: (${text})`);
  }
  const names = new Set(
    expressions
      .flatMap((expression) => valueIdentifierNodes(expression, { skipJsx: true }))
      .map((identifier) => identifier.text)
      .filter((name) => !GLOBALS.has(name)),
  );
  const kinds = new Map<string, VariableKind[]>();
  for (const expression of expressions)
    for (const [name, list] of usageKinds(expression, names))
      kinds.set(name, [...(kinds.get(name) ?? []), ...list]);
  const component = input.real?.[input.tag];
  return {
    ...(inlineStyle ? { inlineStyle } : {}),
    literalProps,
    ...(props.length ? { props: `{ ${props.join(', ')} }` } : {}),
    ...(component && importedFrom(sf, input.tag, component.source) ? { real: true as const } : {}),
    tag: input.tag,
    variables: [...names].sort().map((name) => ({
      kind: mergeKinds(kinds.get(name) ?? ['unknown']),
      name,
    })),
  };
};
