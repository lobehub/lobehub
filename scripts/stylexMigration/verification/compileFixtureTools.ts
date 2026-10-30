import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

import { sha256 } from './report';

/** Type erasure only: never evaluates source plugins in the controller. */
export const compileFixtureTools = async (
  directory: string,
  entries: Array<{ output: string; source: string }>,
  outputDirectory = '.stylex-tools/compiler',
) => {
  const root = await realpath(directory);
  const outputRoot = path.resolve(root, outputDirectory);
  if (!outputRoot.startsWith(path.join(root, '.stylex-tools') + path.sep))
    throw new Error('FIXTURE_COMPILER_PATH_ESCAPE');
  const compiled = new Map<string, { source: string; sourceHash: string; outputHash: string }>();
  let bytes = 0;
  const compile = async (source: string, output: string): Promise<void> => {
    const file = await realpath(path.resolve(root, source));
    const target = path.resolve(outputRoot, output);
    if (!file.startsWith(root + path.sep) || !target.startsWith(outputRoot + path.sep))
      throw new Error('FIXTURE_COMPILER_PATH_ESCAPE');
    const existing = compiled.get(target);
    if (existing) {
      if (existing.source !== file) throw new Error('FIXTURE_COMPILER_OUTPUT_COLLISION');
      return;
    }
    const code = await readFile(file, 'utf8');
    bytes += Buffer.byteLength(code);
    if (compiled.size >= 100 || bytes > 5 * 1024 ** 2)
      throw new Error('FIXTURE_COMPILER_BUDGET_EXCEEDED');
    const transpiled = ts.transpileModule(code, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
      },
      fileName: file,
      reportDiagnostics: true,
    });
    if (
      transpiled.diagnostics?.some(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      )
    )
      throw new Error(`FIXTURE_COMPILER_SYNTAX_ERROR:${source}`);
    const parsed = ts.createSourceFile(
      file + '.js',
      transpiled.outputText,
      ts.ScriptTarget.ES2023,
      true,
      ts.ScriptKind.JS,
    );
    const imports = new Set<string>();
    const visit = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.startsWith('.')
      )
        imports.add(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.startsWith('.')
      )
        throw new Error('FIXTURE_COMPILER_DYNAMIC_LOCAL_IMPORT_UNSUPPORTED');
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    const replacements = new Map<string, string>();
    const pending: Array<{ output: string; source: string }> = [];
    for (const specifier of imports) {
      const stem = path.resolve(path.dirname(file), specifier);
      let resolved: string | undefined;
      for (const candidate of [stem, stem + '.ts', stem + '.js', path.join(stem, 'index.ts')]) {
        try {
          resolved = await realpath(candidate);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (!resolved || !/\.[cm]?[jt]s$/.test(resolved))
        throw new Error(`FIXTURE_COMPILER_LOCAL_IMPORT_UNRESOLVED:${specifier}`);
      const rewritten = specifier.replace(/\.[cm]?[jt]s$/, '') + '.mjs';
      replacements.set(specifier, rewritten);
      pending.push({
        output: path.join(path.dirname(output), rewritten),
        source: path.relative(root, resolved),
      });
    }
    const transformed = ts.transform(parsed, [
      (context) => {
        const rewrite: ts.Visitor = (node) => {
          if (
            ts.isStringLiteral(node) &&
            (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent))
          ) {
            const replacement = replacements.get(node.text);
            if (replacement) return context.factory.createStringLiteral(replacement);
          }
          return ts.visitEachChild(node, rewrite, context);
        };
        return (sourceFile) => ts.visitNode(sourceFile, rewrite) as ts.SourceFile;
      },
    ]);
    const emitted = ts.createPrinter().printFile(transformed.transformed[0]);
    transformed.dispose();
    compiled.set(target, { outputHash: sha256(emitted), source: file, sourceHash: sha256(code) });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, emitted, { flag: 'wx' });
    for (const entry of pending) await compile(entry.source, entry.output);
  };
  for (const entry of entries) await compile(entry.source, entry.output);
  return {
    compiler: `typescript@${ts.version}`,
    modules: [...compiled.entries()].map(([output, evidence]) => ({
      ...evidence,
      output: path.relative(root, output),
      source: path.relative(root, evidence.source),
    })),
  };
};
