import ts from 'typescript';

import { literalOf } from './children';
import type { ComponentImport } from './types';

const STYLE_PROPS = new Set(['className', 'classNames', 'key', 'ref', 'style', 'styles']);

export const componentImport = (
  tag: string,
  importOf: Map<string, ts.ImportDeclaration>,
): ComponentImport | undefined => {
  const statement = importOf.get(tag);
  if (!statement || !ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
  const source = statement.moduleSpecifier.text;
  const clause = statement.importClause;
  if (clause?.name?.text === tag) return { imported: 'default', source };
  const named = clause?.namedBindings;
  const element =
    named && ts.isNamedImports(named)
      ? named.elements.find((item) => item.name.text === tag)
      : undefined;
  return element ? { imported: (element.propertyName ?? element.name).text, source } : undefined;
};

const isLiteral = (attribute: ts.JsxAttribute) => {
  const { initializer } = attribute;
  if (!initializer || ts.isStringLiteral(initializer)) return true;
  return (
    ts.isJsxExpression(initializer) &&
    !!initializer.expression &&
    literalOf(initializer.expression) !== undefined
  );
};

export const propTextsOf = (opening: ts.JsxOpeningLikeElement, ast: ts.SourceFile) =>
  opening.attributes.properties
    .filter(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) &&
        !STYLE_PROPS.has(attribute.name.getText(ast)) &&
        !isLiteral(attribute),
    )
    .map((attribute) => attribute.getText(ast).replaceAll(/\s+/g, ' '))
    .sort();

export const componentFields = (
  tag: string,
  opening: ts.JsxOpeningLikeElement,
  ast: ts.SourceFile,
  importOf: Map<string, ts.ImportDeclaration>,
) => {
  const component = /^[a-z]/.test(tag) ? undefined : componentImport(tag, importOf);
  if (!component) return {};
  const propTexts = propTextsOf(opening, ast);
  return { component, ...(propTexts.length ? { propTexts } : {}) };
};
