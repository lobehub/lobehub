import ts from 'typescript';

import { CSS_TAG_SOURCES, cssConstantFactory, cssTemplatesOf } from './cssConstants';
import { valueIdentifiers } from './identifiers';
import { type ImportedClass, importedClassOf } from './importedClasses';
import type { StyleAdapter, StylesheetBinding } from './types';

const STYLESHEET = /\.css$/;

export interface TopLevel {
  cssConstants: Set<string>;
  importedClasses: Map<string, ImportedClass>;
  importOf: Map<string, ts.ImportDeclaration>;
  keptStatements: Set<ts.Statement>;
  moduleNames: () => string[];
  prelude: () => string;
  require: (name: string) => boolean;
  sideEffectCss: string[];
  styleFactories: Map<string, ts.CallExpression>;
  stylesheets: Array<{ binding: StylesheetBinding; source: string }>;
  styleSymbols: Set<string>;
}

const importedFactory = (
  code: string,
  name: string,
  adapters: StyleAdapter[],
): ts.CallExpression | undefined => {
  const sf = ts.createSourceFile(
    'module.tsx',
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const recognized = (node: ts.Expression | undefined) =>
    node && ts.isCallExpression(node) && adapters.some((adapter) => adapter.recognizeFactory(node))
      ? node
      : undefined;
  for (const statement of sf.statements) {
    if (name === 'default' && ts.isExportAssignment(statement))
      return recognized(statement.expression);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        return recognized(declaration.initializer);
  }
  return undefined;
};

export const collectTopLevel = (
  ast: ts.SourceFile,
  adapters: StyleAdapter[],
  readModule?: (specifier: string) => string | undefined,
): TopLevel => {
  const importOf = new Map<string, ts.ImportDeclaration>();
  const declarations = new Map<string, ts.Statement>();
  const styleSymbols = new Set<string>();
  const styleFactories = new Map<string, ts.CallExpression>();
  const cssConstants = new Set<string>();
  const importedClasses = new Map<string, ImportedClass>();
  const sideEffectCss: string[] = [];
  const isCssTag = (name: string) => {
    const statement = importOf.get(name);
    const named = statement?.importClause?.namedBindings;
    return (
      !!statement &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      CSS_TAG_SOURCES.has(statement.moduleSpecifier.text) &&
      !!named &&
      ts.isNamedImports(named) &&
      named.elements.some(
        (element) =>
          element.name.text === name && (element.propertyName ?? element.name).text === 'css',
      )
    );
  };
  const stylesheets: TopLevel['stylesheets'] = [];

  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const source = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      for (const adapter of adapters) {
        const binding = adapter.stylesheet?.(source, clause);
        if (binding) {
          stylesheets.push({ binding, source });
          break;
        }
      }
      if (!clause) {
        if (STYLESHEET.test(source)) sideEffectCss.push(statement.getText(ast));
        continue;
      }
      if (clause.isTypeOnly) continue;
      if (clause.name) importOf.set(clause.name.text, statement);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) importOf.set(named.name.text, statement);
      if (named && ts.isNamedImports(named))
        for (const element of named.elements)
          if (!element.isTypeOnly) importOf.set(element.name.text, statement);
      for (const adapter of adapters)
        for (const symbol of adapter.importedStyleSymbols?.(source, clause) ?? [])
          styleSymbols.add(symbol);
      const module = readModule && !STYLESHEET.test(source) ? readModule(source) : undefined;
      if (module) {
        const names: Array<[string, string]> = [];
        if (clause.name) names.push([clause.name.text, 'default']);
        if (named && ts.isNamedImports(named))
          for (const element of named.elements)
            if (!element.isTypeOnly)
              names.push([element.name.text, (element.propertyName ?? element.name).text]);
        for (const [local, imported] of names) {
          const factory = importedFactory(module, imported, adapters);
          if (factory) {
            styleSymbols.add(local);
            styleFactories.set(local, factory);
            continue;
          }
          const derived = importedClassOf(module, imported, local, adapters);
          if (derived) importedClasses.set(local, derived);
        }
      }
      continue;
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.set(declaration.name.text, statement);
        const initializer = declaration.initializer;
        if (
          initializer &&
          ts.isCallExpression(initializer) &&
          adapters.some((adapter) => adapter.recognizeFactory(initializer))
        ) {
          styleSymbols.add(declaration.name.text);
          styleFactories.set(declaration.name.text, initializer);
          continue;
        }
        const templates = initializer && cssTemplatesOf(initializer, isCssTag);
        const factory = templates && cssConstantFactory(ast, declaration.name.text, templates);
        if (factory) {
          styleSymbols.add(declaration.name.text);
          styleFactories.set(declaration.name.text, factory);
          cssConstants.add(declaration.name.text);
        }
      }
    if (ts.isFunctionDeclaration(statement) && statement.name)
      declarations.set(statement.name.text, statement);
  }

  const keptStatements = new Set<ts.Statement>();
  const keptImports = new Map<ts.ImportDeclaration, Set<string>>();
  const require = (name: string): boolean => {
    const imported = importOf.get(name);
    if (imported) {
      keptImports.set(imported, (keptImports.get(imported) ?? new Set()).add(name));
      return true;
    }
    const statement = declarations.get(name);
    if (!statement) return false;
    if (keptStatements.has(statement)) return true;
    keptStatements.add(statement);
    for (const dependency of valueIdentifiers(statement, { includeTags: true }))
      require(dependency);
    return true;
  };
  for (const symbol of styleSymbols) require(symbol);

  const prelude = () => {
    const lines = [...sideEffectCss];
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement)) {
        const names = keptImports.get(statement);
        if (!names) continue;
        const clause = statement.importClause!;
        const parts: string[] = [];
        if (clause.name && names.has(clause.name.text)) parts.push(clause.name.text);
        const named = clause.namedBindings;
        if (named && ts.isNamespaceImport(named) && names.has(named.name.text))
          parts.push(`* as ${named.name.text}`);
        if (named && ts.isNamedImports(named)) {
          const kept = named.elements
            .filter((element) => !element.isTypeOnly && names.has(element.name.text))
            .map((element) => element.getText(ast));
          if (kept.length) parts.push(`{ ${kept.join(', ')} }`);
        }
        if (parts.length)
          lines.push(`import ${parts.join(', ')} from ${statement.moduleSpecifier.getText(ast)};`);
        continue;
      }
      if (keptStatements.has(statement))
        lines.push(statement.getText(ast).replace(/^export\s+(?:default\s+)?/, ''));
    }
    return lines.join('\n');
  };

  const moduleNames = () => [...new Set([...importOf.keys(), ...declarations.keys()])].sort();

  return {
    cssConstants,
    importedClasses,
    importOf,
    keptStatements,
    moduleNames,
    prelude,
    require,
    sideEffectCss,
    styleFactories,
    styleSymbols,
    stylesheets,
  };
};
