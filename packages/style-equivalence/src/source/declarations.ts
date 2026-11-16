import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import postcss from 'postcss';
import ts from 'typescript';

import { cssTemplatesOf } from '../extract/cssConstants';
import { NAMESPACE } from '../extract/importedClasses';
import { classNamesIn } from '../extract/selectors';
import { aliasCandidates } from './aliases';

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export const propertyNameOf = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)
      ? name.expression.text
      : undefined;

export const parseSource = (code: string, file = 'source.tsx') =>
  ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

export const findStyleMember = (sf: ts.SourceFile, symbol: string, member: string) => {
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (
      !declaration &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === symbol &&
      node.initializer
    )
      declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const initializer = declaration?.initializer;
  if (!initializer) return undefined;
  if (member === symbol && cssTemplatesOf(initializer, (name) => name === 'css'))
    return declaration;
  if (!ts.isCallExpression(initializer)) return undefined;
  const call = initializer;
  let queue: ts.Node[] = [...call.arguments];
  while (queue.length) {
    const next: ts.Node[] = [];
    for (const node of queue) {
      if (ts.isPropertyAssignment(node) && propertyNameOf(node.name) === member) return node;
      ts.forEachChild(node, (child) => {
        next.push(child);
      });
    }
    queue = next;
  }
  return undefined;
};

export const resolveSpecifier = (
  root: string,
  from: string,
  specifier: string,
  aliases: Record<string, string>,
) => {
  const bases = specifier.startsWith('.')
    ? [path.join(path.dirname(from), specifier)]
    : aliasCandidates(root, specifier, aliases);
  return bases
    .flatMap((base) => EXTENSIONS.map((extension) => path.normalize(base + extension)))
    .find((candidate) => {
      const absolute = path.join(root, candidate);
      return existsSync(absolute) && path.extname(candidate) !== '';
    });
};

export const importsOf = (code: string) => {
  const sf = parseSource(code);
  const named = new Map<string, { imported: string; specifier: string }>();
  const sideEffects: string[] = [];
  const locals = new Set<string>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (!clause) {
        sideEffects.push(specifier);
        continue;
      }
      if (clause.name) named.set(clause.name.text, { imported: 'default', specifier });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          named.set(element.name.text, {
            imported: (element.propertyName ?? element.name).text,
            specifier,
          });
      continue;
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) locals.add(declaration.name.text);
  }
  return { locals, named, sideEffects };
};

export interface SlotSite {
  code: string;
  css: boolean;
  kind: 'import' | 'source';
  member: string;
  path: string;
  specifier?: string;
  symbol: string;
}

export const resolveSlot = (
  root: string,
  source: string,
  code: string,
  slot: string,
  aliases: Record<string, string>,
): SlotSite[] => {
  const dot = slot.indexOf('.');
  const [symbol, member] = [slot.slice(0, dot), slot.slice(dot + 1)];
  const { locals, named, sideEffects } = importsOf(code);
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
  if (symbol === 'global')
    return sideEffects.flatMap((specifier) => {
      const file = resolveSpecifier(root, source, specifier, aliases);
      if (!file?.endsWith('.css')) return [];
      return [
        {
          code: read(file),
          css: true,
          kind: 'import' as const,
          member,
          path: file,
          specifier,
          symbol,
        },
      ];
    });
  if (locals.has(symbol))
    return [{ code, css: false, kind: 'source', member, path: source, symbol }];
  const [via, inner] = symbol.split(NAMESPACE);
  if (inner) {
    const owner = named.get(via);
    const file = owner && resolveSpecifier(root, source, owner.specifier, aliases);
    return owner && file
      ? [
          {
            code: read(file),
            css: false,
            kind: 'import',
            member,
            path: file,
            specifier: owner.specifier,
            symbol: inner,
          },
        ]
      : [];
  }
  const imported = named.get(symbol);
  const file = imported && resolveSpecifier(root, source, imported.specifier, aliases);
  if (!imported || !file) return [];
  return [
    {
      code: read(file),
      css: file.endsWith('.css'),
      kind: 'import',
      member,
      path: file,
      specifier: imported.specifier,
      symbol: imported.imported,
    },
  ];
};

export const classRulesText = (css: string, className: string) => {
  const texts: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    if (!classNamesIn(rule.selector).includes(className)) return;
    const parents: string[] = [];
    for (let parent = rule.parent; parent && parent.type === 'atrule'; parent = parent.parent)
      parents.unshift(`@${parent.name} ${parent.params}`);
    texts.push([...parents, rule.toString()].join(' '));
  });
  return texts.join('\n');
};

export const declarationText = (site: SlotSite) => {
  if (site.css) return classRulesText(site.code, site.member);
  const property = findStyleMember(parseSource(site.code), site.symbol, site.member);
  return property ? property.getText() : `UNRESOLVED:${site.symbol}.${site.member}`;
};
