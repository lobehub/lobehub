import ts from 'typescript';

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
  return found.map((node) => ({
    attributes: node.attributes.getText(sf).replaceAll(/\s+/g, ''),
    text: dedent(node.getText(sf)),
  }));
};

export interface CounterpartInput {
  expr: string;
  from: string;
  owner: string;
  tag: string;
  to: string;
}

export const counterpartOf = ({ expr, from, owner, tag, to }: CounterpartInput) => {
  const others = openingsOf(to, owner, tag);
  if (!others.length) return undefined;
  const needle = expr.replaceAll(/\s+/g, '');
  const mine = openingsOf(from, owner, tag);
  const index = mine.findIndex((opening) => opening.attributes.includes(needle));
  if (index !== -1 && mine.length === others.length) return others[index].text;
  return others.length === 1 ? others[0].text : undefined;
};
