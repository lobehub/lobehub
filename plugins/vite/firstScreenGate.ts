import { gzipSync } from 'node:zlib';

import type { Plugin } from 'vite';

interface ChunkLike {
  code: string;
  fileName: string;
  imports: string[];
  isEntry: boolean;
  moduleIds: string[];
  modules: Record<string, { renderedLength: number }>;
  name: string;
  type: 'chunk' | 'asset';
}

interface ModuleInfoLike {
  importedIds: string[];
  isEntry: boolean;
}

export interface FirstScreenGateOptions {
  entryName?: string;
  forbidden: Record<string, (id: string) => boolean>;
  maxGzipKB: number;
  maxUnreachableKB?: number;
}

export const firstScreenForbidden: FirstScreenGateOptions['forbidden'] = {
  'ajv': (id) => id.includes('/node_modules/ajv/'),
  'builtin-skill bodies': (id) =>
    id.includes('/packages/builtin-skills/src/') && !/\/manifests?\.ts$/.test(id),
  'database models': (id) =>
    id.includes('/packages/database/src/') &&
    !id.includes('/models/agentDocuments/policy/') &&
    !id.endsWith('/models/agentDocuments/types.ts'),
  'drizzle': (id) => /\/node_modules\/drizzle-(?:orm|zod)\//.test(id),
  'editor runtime': (id) => /\/node_modules\/(?:lexical|@lexical|yjs|fuse\.js)\//.test(id),
  'en-US locale json': (id) => /\/locales\/en-US\/[^/]+\.json$/.test(id),
  'model-bank catalog': (id) => id.endsWith('/packages/model-bank/src/aiModels/index.ts'),
  'posthog': (id) => id.includes('/node_modules/posthog-js/'),
  'tool store': (id) => id.includes('/src/store/tool/'),
};

export interface FirstScreenReport {
  eagerChunks: string[];
  gzipKB: number;
  unreachableKB: number;
  violations: string[];
}

const normalize = (id: string) => id.replaceAll('\\', '/').split('?')[0];

export const collectFirstScreen = (
  bundle: Record<string, ChunkLike>,
  getModuleInfo: (id: string) => ModuleInfoLike | null,
  options: FirstScreenGateOptions,
): FirstScreenReport => {
  const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
  const entry = chunks.find((c) => c.isEntry && c.name === (options.entryName ?? 'index'));
  if (!entry)
    throw new Error(`[first-screen-gate] entry chunk "${options.entryName ?? 'index'}" not found`);

  const eager = new Set<string>();
  const chunkStack = [entry.fileName];
  while (chunkStack.length) {
    const fileName = chunkStack.pop()!;
    if (eager.has(fileName)) continue;
    eager.add(fileName);
    for (const dep of bundle[fileName].imports) chunkStack.push(dep);
  }

  const reachable = new Set<string>();
  const seeds = entry.moduleIds.filter((id) => getModuleInfo(id)?.isEntry);
  const moduleStack = [...(seeds.length ? seeds : entry.moduleIds)];
  while (moduleStack.length) {
    const id = moduleStack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const dep of getModuleInfo(id)?.importedIds ?? []) moduleStack.push(dep);
  }

  let gzip = 0;
  let unreachable = 0;
  const hits = new Map<string, string[]>();
  for (const fileName of eager) {
    const chunk = bundle[fileName];
    gzip += gzipSync(chunk.code).length;
    for (const [id, mod] of Object.entries(chunk.modules)) {
      if (!reachable.has(id)) unreachable += mod.renderedLength;
      const normalized = normalize(id);
      for (const [rule, test] of Object.entries(options.forbidden)) {
        if (test(normalized)) hits.set(rule, [...(hits.get(rule) ?? []), normalized]);
      }
    }
  }

  const gzipKB = Math.round(gzip / 1024);
  const unreachableKB = Math.round(unreachable / 1024);
  const violations: string[] = [];
  if (gzipKB > options.maxGzipKB)
    violations.push(`first-screen gzip ${gzipKB}KB exceeds budget ${options.maxGzipKB}KB`);
  if (options.maxUnreachableKB !== undefined && unreachableKB > options.maxUnreachableKB)
    violations.push(
      `${unreachableKB}KB emitted into eager chunks without a static path from the entry (budget ${options.maxUnreachableKB}KB)`,
    );
  for (const [rule, ids] of hits)
    violations.push(
      `${rule} reached the first screen: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ` (+${ids.length - 3})` : ''}`,
    );

  return { eagerChunks: [...eager], gzipKB, unreachableKB, violations };
};

export const viteFirstScreenGate = (options: FirstScreenGateOptions): Plugin => ({
  apply: 'build',
  name: 'lobe-first-screen-gate',
  generateBundle(_, bundle) {
    const report = collectFirstScreen(
      bundle as unknown as Record<string, ChunkLike>,
      (id) => this.getModuleInfo(id),
      options,
    );
    this.info(
      `[first-screen-gate] ${report.eagerChunks.length} eager chunks, ${report.gzipKB}KB gzip, ${report.unreachableKB}KB unreachable`,
    );
    if (report.violations.length) {
      this.error(
        `[first-screen-gate]\n  ${report.violations.join('\n  ')}\n  Move the import behind import() or a subpath export; the boot-path rules in eslint.config.mjs name the usual culprits.`,
      );
    }
  },
});
