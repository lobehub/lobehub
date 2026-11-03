import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CanvasRuntimeBundle,
  CanvasRuntimeManifest,
  CanvasRuntimeModule,
} from '@lobechat/canvas/runtime';
import { build, type ESTree, parseAst, type Plugin, type ResolvedConfig, Visitor } from 'vite';

const virtualId = 'virtual:canvas-runtime';
const resolvedId = `\0${virtualId}`;
const runtimeRoot = fileURLToPath(new URL('../../packages/canvas-runtime/', import.meta.url));

export const canvasRuntimeEntries = {
  runtime: path.join(runtimeRoot, 'src/index.tsx'),
  highlight: path.join(runtimeRoot, 'src/addons/highlight.ts'),
  mermaid: path.join(runtimeRoot, 'src/addons/mermaid.ts'),
};

const describeModule = (code: string, id: string): Omit<CanvasRuntimeModule, 'code' | 'url'> => {
  const imports: CanvasRuntimeModule['imports'] = [];
  const meta: NonNullable<CanvasRuntimeModule['meta']> = [];
  const reference = (source: ESTree.Node) => {
    if (source.type !== 'Literal' || typeof source.value !== 'string') return;
    imports.push({
      start: source.start,
      end: source.end,
      target: path.posix.normalize(
        path.posix.join(path.posix.dirname(id), source.value.split('?')[0]),
      ),
    });
  };
  new Visitor({
    ImportDeclaration: (node) => reference(node.source),
    ExportAllDeclaration: (node) => reference(node.source),
    ExportNamedDeclaration: (node) => {
      if (node.source) reference(node.source);
    },
    ImportExpression: (node) => reference(node.source),
    MemberExpression(node) {
      if (
        node.object.type === 'MetaProperty' &&
        node.property.type === 'Identifier' &&
        node.property.name === 'url'
      )
        meta.push({ start: node.start, end: node.end });
    },
  }).visit(parseAst(code));
  return { id, imports, meta };
};

export function canvasRuntime(): Plugin {
  let config: ResolvedConfig;
  let references: Record<keyof typeof canvasRuntimeEntries, string> | undefined;
  let development: Promise<CanvasRuntimeBundle> | undefined;
  return {
    name: 'lobe-canvas-runtime',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      const compile = async (): Promise<CanvasRuntimeBundle> => {
        const modules: CanvasRuntimeModule[] = [];
        const styles: string[] = [];
        const entries = { runtime: '', highlight: '', mermaid: '' };
        for (const name of ['runtime', 'highlight', 'mermaid'] as const) {
          const result = await build({
            root: runtimeRoot,
            configFile: path.join(runtimeRoot, 'vite.config.ts'),
            mode: name === 'runtime' ? 'production' : name,
            logLevel: 'error',
            build: { write: false, emptyOutDir: false },
          });
          const outputs = Array.isArray(result) ? result : [result];
          const files = outputs.flatMap((output) => {
            if (!('output' in output)) throw new Error('Canvas dev build did not return a bundle');
            return output.output;
          });
          for (const file of files) {
            if (file.type === 'chunk') {
              entries[name] = file.fileName;
              modules.push({
                id: file.fileName,
                code: file.code,
                imports: [],
                url: new URL(file.fileName, 'http://localhost/').href,
              });
            } else if (file.fileName.endsWith('.css')) {
              styles.push(
                typeof file.source === 'string'
                  ? file.source
                  : new TextDecoder().decode(file.source),
              );
            }
          }
        }
        return { entries, modules, styles };
      };
      server.middlewares.use('/@lobe-canvas/runtime.json', async (_request, response) => {
        try {
          development ??= compile().catch((error) => {
            development = undefined;
            throw error;
          });
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ bundle: await development }));
        } catch (error) {
          server.config.logger.error(String(error));
          response.statusCode = 500;
          response.end('Canvas runtime compilation failed');
        }
      });
      server.watcher.on('change', (file) => {
        if (file.startsWith(runtimeRoot) || file.includes('/packages/canvas/src/')) {
          development = undefined;
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      if (config.command === 'serve')
        return 'const endpoint = "/@lobe-canvas/runtime.json"; export default new URL(endpoint, import.meta.url).href';
      references ??= Object.fromEntries(
        Object.entries(canvasRuntimeEntries).map(([name, entry]) => [
          name,
          this.emitFile({
            type: 'chunk',
            id: entry,
            name: `canvas-${name}`,
            preserveSignature: 'strict',
          }),
        ]),
      ) as Record<keyof typeof canvasRuntimeEntries, string>;
      return `export default import.meta.ROLLUP_FILE_URL_${references!.runtime} + ".json";`;
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (!references) return;
        const entries = Object.fromEntries(
          Object.entries(references).map(([name, reference]) => [
            name,
            this.getFileName(reference),
          ]),
        ) as CanvasRuntimeManifest['entries'];
        const modules = new Map<string, CanvasRuntimeManifest['modules'][number]>();
        const styles = new Set<string>();
        const entryStyles: CanvasRuntimeManifest['entryStyles'] = {};
        const visit = (id: string) => {
          if (modules.has(id)) return;
          const chunk = bundle[id];
          if (!chunk || chunk.type !== 'chunk')
            this.error(`Canvas module is not in the App bundle: ${id}`);
          const module = describeModule(chunk.code, id);
          modules.set(id, module);
          for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) visit(dependency);
          for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css);
        };
        for (const [name, entry] of Object.entries(entries)) {
          styles.clear();
          modules.clear();
          visit(entry);
          entryStyles[name as keyof typeof entries] = [...styles];
        }
        modules.clear();
        styles.clear();
        for (const entry of Object.values(entries)) visit(entry);
        this.emitFile({
          type: 'asset',
          fileName: `${entries.runtime}.json`,
          source: JSON.stringify({
            base: config.base,
            entries,
            entryStyles,
            modules: [...modules.values()],
            styles: [...styles],
          } satisfies CanvasRuntimeManifest),
        });
      },
    },
    async writeBundle() {
      // The standalone IIFE belongs to published pages, never to an App renderer.
      await rm(path.resolve(config.root, config.build.outDir, 'canvas-runtime'), {
        force: true,
        recursive: true,
      });
    },
  };
}
