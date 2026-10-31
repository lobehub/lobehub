import { access, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

export interface ImportEdge {
  from: string;
  specifier: string;
  to: string;
}

export interface ImportGraph {
  boundaries: string[];
  files: string[];
  imports: ImportEdge[];
}

export interface TraceImportGraphOptions {
  compilerOptions: ts.CompilerOptions;
  entries: string[];
  forbiddenImports?: RegExp[];
  isBoundary?: (file: string, sourceFile: ts.SourceFile) => boolean;
  mustResolve?: (specifier: string, file: string) => boolean;
  root: string;
  skip?: (file: string) => boolean;
}

export interface AddWorkspacePathsOptions {
  packagesDirs?: string[];
}

const CODE_FILE = /\.[cm]?[jt]sx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(?:test|spec|d)\.[cm]?tsx?$/;
const IGNORED_DIRECTORIES = new Set(['dist', 'node_modules']);
const ASSET_EXTENSIONS = new Set([
  '.avif',
  '.css',
  '.gif',
  '.gql',
  '.graphql',
  '.html',
  '.ico',
  '.jpeg',
  '.jpg',
  '.json',
  '.less',
  '.md',
  '.mdx',
  '.png',
  '.sass',
  '.scss',
  '.sql',
  '.svg',
  '.toml',
  '.ttf',
  '.txt',
  '.wasm',
  '.webp',
  '.woff',
  '.woff2',
  '.yaml',
  '.yml',
]);

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

const readJson = async <T>(file: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
};

const scriptKind = (file: string) =>
  file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(file)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

export const listSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') && !IGNORED_DIRECTORIES.has(entry.name))
      .map(async (entry) => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) return listSourceFiles(file);
        return /\.[cm]?tsx?$/.test(file) && !TEST_FILE.test(file) ? [file] : [];
      }),
  );
  return files.flat().sort();
};

export const hasDirective = (sourceFile: ts.SourceFile, directive: string) => {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression))
      return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
};

export const isUseClientBoundary = (_file: string, sourceFile: ts.SourceFile) =>
  hasDirective(sourceFile, 'use client');

const matchesPathPattern = (specifier: string, pattern: string) => {
  const star = pattern.indexOf('*');
  if (star === -1) return specifier === pattern;
  return (
    specifier.length >= pattern.length - 1 &&
    specifier.startsWith(pattern.slice(0, star)) &&
    specifier.endsWith(pattern.slice(star + 1))
  );
};

export const defaultMustResolve =
  (compilerOptions: ts.CompilerOptions) =>
  (specifier: string): boolean => {
    if (specifier.includes('?') || ASSET_EXTENSIONS.has(path.extname(specifier).toLowerCase()))
      return false;
    if (specifier.startsWith('.') || path.isAbsolute(specifier)) return true;
    return Object.keys(compilerOptions.paths ?? {}).some((pattern) =>
      matchesPathPattern(specifier, pattern),
    );
  };

// Declarations of generated text assets have no executable imports or translation calls.
const isInertDeclaration = (declaration: ts.SourceFile) =>
  declaration.statements.length > 0 &&
  declaration.statements.every(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.every(
        (item) => item.type?.kind === ts.SyntaxKind.StringKeyword && !item.initializer,
      ),
  );

const collectSpecifiers = (file: string, ast: ts.SourceFile) => {
  const specifiers: string[] = [];
  const collect = (node: ts.Node) => {
    let argument: ts.Node | undefined;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      argument = node.moduleSpecifier;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      argument = node.arguments[0];
    if (argument) {
      if (!ts.isStringLiteralLike(argument))
        throw new Error(`Unresolved dynamic import in ${file}: ${argument.getText(ast)}`);
      specifiers.push(argument.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(ast);
  return specifiers;
};

export const traceImportGraph = async ({
  compilerOptions,
  entries,
  forbiddenImports = [],
  isBoundary,
  mustResolve = defaultMustResolve(compilerOptions),
  root,
  skip,
}: TraceImportGraphOptions): Promise<ImportGraph> => {
  const cache = ts.createModuleResolutionCache(root, (file) => file, compilerOptions);
  const transpileOptions: ts.CompilerOptions = {
    ...compilerOptions,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    verbatimModuleSyntax: false,
  };
  const seen = new Set<string>();
  const boundaries = new Set<string>();
  const imports: ImportEdge[] = [];
  const assertAllowed = (file: string, reference: string) => {
    if (forbiddenImports.some((pattern) => pattern.test(reference)))
      throw new Error(`Forbidden import: ${file} -> ${reference}`);
  };
  const visit = async (input: string) => {
    const file = await realpath(input);
    if (seen.has(file) || boundaries.has(file) || skip?.(file)) return;
    const source = await readFile(file, 'utf8');
    if (isBoundary) {
      const original = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(file),
      );
      if (isBoundary(file, original)) {
        boundaries.add(file);
        return;
      }
    }
    seen.add(file);
    const output = ts.transpileModule(source, {
      compilerOptions: transpileOptions,
      fileName: file,
    }).outputText;
    const ast = ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    for (const specifier of collectSpecifiers(file, ast)) {
      assertAllowed(file, specifier);
      const resolution = ts.resolveModuleName(
        specifier,
        file,
        compilerOptions,
        ts.sys,
        cache,
      ).resolvedModule;
      if (!resolution) {
        if (mustResolve(specifier, file))
          throw new Error(`Unresolved import: ${file} -> ${specifier}`);
        continue;
      }
      const target = await realpath(resolution.resolvedFileName);
      if (skip?.(target)) continue;
      assertAllowed(file, target);
      if (target.includes(`${path.sep}node_modules${path.sep}`)) continue;
      if (DECLARATION_FILE.test(target)) {
        const declaration = ts.createSourceFile(
          target,
          await readFile(target, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        if (!isInertDeclaration(declaration))
          throw new Error(
            `Cannot trace runtime through a declaration file: ${file} -> ${target}; expose the runtime source to the extractor`,
          );
        continue;
      }
      if (!CODE_FILE.test(target)) continue;
      imports.push({ from: file, specifier, to: target });
      await visit(target);
    }
  };
  for (const entry of entries) await visit(path.resolve(root, entry));
  return { boundaries: [...boundaries].sort(), files: [...seen].sort(), imports };
};

interface RootManifest {
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
}

interface PackageManifest {
  exports?: string | Record<string, string | { default?: string; types?: string }>;
  name?: string;
}

export const addWorkspacePaths = async (
  root: string,
  compilerOptions: ts.CompilerOptions,
  { packagesDirs = ['packages'] }: AddWorkspacePathsOptions = {},
) => {
  const rootManifest = (await readJson<RootManifest>(path.join(root, 'package.json'))) ?? {};
  const aliases = new Map<string, string[]>();
  for (const [name, value] of Object.entries({
    ...rootManifest.dependencies,
    ...rootManifest.overrides,
    ...rootManifest.pnpm?.overrides,
  })) {
    const target = /^workspace:(.+)@[^@]+$/.exec(value)?.[1];
    if (target) aliases.set(target, [...(aliases.get(target) ?? []), name]);
  }
  const register = async (directory: string, manifest: PackageManifest) => {
    if (!manifest.name) return;
    const names = [...(aliases.get(manifest.name) ?? [])];
    // Installed links stay authoritative; only packages missing from node_modules need a source path.
    try {
      await access(path.join(root, 'node_modules', manifest.name, 'package.json'));
    } catch {
      names.push(manifest.name);
    }
    if (!names.length) return;
    const exports =
      typeof manifest.exports === 'string' ? { '.': manifest.exports } : (manifest.exports ?? {});
    for (const [subpath, target] of Object.entries(exports)) {
      const value = typeof target === 'string' ? target : (target.types ?? target.default);
      if (!value) throw new Error(`Unsupported workspace export: ${manifest.name}/${subpath}`);
      for (const packageName of names) {
        const name = packageName + (subpath === '.' ? '' : subpath.slice(1));
        compilerOptions.paths ??= {};
        compilerOptions.paths[name] ??= [path.resolve(directory, value)];
      }
    }
  };
  const visit = async (directory: string) => {
    const manifest = await readJson<PackageManifest>(path.join(directory, 'package.json'));
    if (manifest) return register(directory, manifest);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const entry of entries)
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !IGNORED_DIRECTORIES.has(entry.name) &&
        entry.name !== 'src'
      )
        await visit(path.join(directory, entry.name));
  };
  for (const directory of packagesDirs) await visit(path.resolve(root, directory));
  return compilerOptions;
};
