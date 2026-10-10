import { access, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

export const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith('.') && !['node_modules', 'dist'].includes(e.name))
      .map(async (e) => {
        const file = path.join(directory, e.name);
        return e.isDirectory()
          ? sourceFiles(file)
          : /\.[cm]?tsx?$/.test(file) && !/\.(?:test|spec|d)\.[cm]?tsx?$/.test(file)
            ? [file]
            : [];
      }),
  );
  return files.flat();
};

export interface SourceGraph {
  clientBoundaries: string[];
  files: string[];
  imports: { from: string; specifier: string; to: string }[];
}

/** Follow runtime imports, including workspace exports; type-only imports are erased first. */
export const traceServerGraph = async (
  root: string,
  entries: string[],
  options: ts.CompilerOptions,
): Promise<SourceGraph> => {
  const cache = ts.createModuleResolutionCache(root, (file) => file, options);
  const seen = new Set<string>();
  const clientBoundaries = new Set<string>();
  const imports: SourceGraph['imports'] = [];
  const visit = async (file: string) => {
    file = await realpath(file);
    if (seen.has(file) || file.includes('/server/generated/')) return;
    const source = await readFile(file, 'utf8');
    const original = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    if (
      original.statements.some(
        (statement) =>
          ts.isExpressionStatement(statement) &&
          ts.isStringLiteral(statement.expression) &&
          statement.expression.text === 'use client',
      )
    ) {
      clientBoundaries.add(file);
      return;
    }
    seen.add(file);
    const output = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        ...options,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        verbatimModuleSyntax: false,
      },
    }).outputText;
    const ast = ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const specifiers: string[] = [];
    const collect = (node: ts.Node) => {
      let argument: ts.Node | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        argument = node.moduleSpecifier;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(ast) === 'require')
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
    for (const specifier of specifiers) {
      if (specifier.includes('/server/generated/') || specifier === './server/generated/resources')
        continue;
      if (
        /locales\/(?:default|create)|loadI18nNamespaceModule|locales\/.*\.json|^i18next$|^react-i18next$/.test(
          specifier,
        )
      )
        throw new Error(`Server imports unprojected locale resources: ${file} -> ${specifier}`);
      const resolution = ts.resolveModuleName(
        specifier,
        file,
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      if (!resolution) {
        if (
          specifier.startsWith('@/') ||
          specifier.startsWith('@lobechat/') ||
          (specifier.startsWith('.') && !/\.(?:md|json)$/.test(specifier))
        )
          throw new Error(`Unresolved server import: ${file} -> ${specifier}`);
        continue;
      }
      const target = await realpath(resolution.resolvedFileName);
      if (
        /\/packages\/locales\/src\/(?:default\/|create\.)|\/locales\/[^/]+\/[^/]+\.json$/.test(
          target,
        )
      )
        throw new Error(`Server imports unprojected locale resources: ${file} -> ${target}`);
      if (target.endsWith('.d.ts') && !target.includes('/node_modules/')) {
        const declaration = ts.createSourceFile(
          target,
          await readFile(target, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        // Generated text assets have no executable imports or translation calls.
        const isTextAsset =
          !target.includes('/packages/') &&
          declaration.statements.length > 0 &&
          declaration.statements.every(
            (statement) =>
              ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.every(
                (item) => item.type?.kind === ts.SyntaxKind.StringKeyword && !item.initializer,
              ),
          );
        if (!isTextAsset)
          throw new Error(
            `Cannot trace workspace runtime through a declaration file: ${file} -> ${target}; expose the runtime source to the extractor`,
          );
      }
      if (
        target.includes('/node_modules/') ||
        target.endsWith('.d.ts') ||
        !/\.[cm]?[jt]sx?$/.test(target)
      )
        continue;
      imports.push({ from: file, specifier, to: target });
      await visit(target);
    }
  };
  for (const entry of entries) await visit(entry);
  return { files: [...seen].sort(), imports, clientBoundaries: [...clientBoundaries] };
};

/** Missing workspace symlinks must not make source packages disappear from analysis. */
export const addWorkspacePaths = async (root: string, options: ts.CompilerOptions) => {
  let rootManifest: {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  } = {};
  try {
    rootManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const aliases = new Map<string, string[]>();
  for (const [name, value] of Object.entries({
    ...rootManifest.dependencies,
    ...rootManifest.overrides,
    ...rootManifest.pnpm?.overrides,
  })) {
    const target = /^workspace:(.+)@[^@]+$/.exec(value)?.[1];
    if (target) aliases.set(target, [...(aliases.get(target) ?? []), name]);
  }
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'package.json')) {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')) as {
        name: string;
        exports?: Record<string, string | { types?: string; default?: string }>;
      };
      const names = [...(aliases.get(manifest.name) ?? [])];
      try {
        await access(path.join(root, 'node_modules', manifest.name, 'package.json'));
      } catch {
        names.push(manifest.name);
      }
      if (!names.length) return;
      for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        const value = typeof target === 'string' ? target : (target.types ?? target.default);
        if (!value) throw new Error(`Unsupported workspace export: ${manifest.name}/${subpath}`);
        for (const packageName of names) {
          const name = packageName + (subpath === '.' ? '' : subpath.slice(1));
          options.paths ??= {};
          options.paths[name] ??= [path.resolve(directory, value)];
        }
      }
      return;
    }
    for (const entry of entries)
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !['node_modules', 'dist', 'src'].includes(entry.name)
      )
        await visit(path.join(directory, entry.name));
  };
  await visit(path.join(root, 'packages'));
};
