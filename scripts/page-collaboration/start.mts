import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'vite';

import { loadPageCollaborationEnvironment } from './environment.mjs';

/**
 * The repository root is intentionally CommonJS by default. The collaboration
 * composition imports ESM-only editor modules through several server services,
 * so handing `start.ts` directly to tsx lets the root package format leak into
 * that graph. Build the composition as one Node ESM artifact at the process
 * boundary instead. Workspace packages are bundled into that artifact, while
 * editor and Yjs stay external so their native ESM identities remain intact.
 */
const repositoryRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const compositionEntry = fileURLToPath(new URL('./start.ts', import.meta.url));
const seedEntry = fileURLToPath(new URL('./seedSnapshot.ts', import.meta.url));
const relaySource = fileURLToPath(new URL('./server.cjs', import.meta.url));
const runtimeRoot = path.join(repositoryRoot, 'dist/page-collaboration');

export type PageCollaborationBundle = 'relay' | 'seed';

export const buildPageCollaborationBundle = async (
  bundle: PageCollaborationBundle = 'relay',
): Promise<URL> => {
  const runtimeDirectory = path.join(runtimeRoot, `${bundle}-${process.pid}-${randomUUID()}`);
  const runtimeRelay = path.join(runtimeDirectory, 'server.cjs');
  await mkdir(runtimeDirectory, { recursive: true });
  const entry = bundle === 'relay' ? compositionEntry : seedEntry;
  const entryFileName = bundle === 'relay' ? 'start.mjs' : 'seed.mjs';

  try {
    await build({
      configFile: false,
      root: repositoryRoot,
      resolve: {
        dedupe: ['@lobehub/editor'],
        tsconfigPaths: true,
      },
      build: {
        // The relay runtime has no browser assets; copying the repository's
        // large public tree into every per-process bundle is unnecessary.
        copyPublicDir: false,
        emptyOutDir: true,
        minify: false,
        outDir: runtimeDirectory,
        rollupOptions: {
          external: [/^@lobehub\/editor(?:\/|$)/, 'yjs'],
          output: {
            codeSplitting: false,
            entryFileNames: entryFileName,
            format: 'es',
          },
        },
        ssr: entry,
      },
      ssr: {
        // Bundle source workspace packages as ESM too. Leaving them external
        // would re-enter their package-local CommonJS boundaries at runtime.
        noExternal: [/^@lobechat\//],
      },
    });

    // The relay is deliberately kept as CJS. Copy it next to the generated
    // ESM composition so createRequire('./server.cjs') continues to resolve at
    // the runtime boundary without changing the relay's Yjs bridge.
    if (bundle === 'relay') await copyFile(relaySource, runtimeRelay);
    return pathToFileURL(path.join(runtimeDirectory, entryFileName));
  } catch (error) {
    await rm(runtimeDirectory, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
};

interface PageCollaborationServer {
  close: () => Promise<void>;
}

interface PageCollaborationCompositionModule {
  startPageCollaborationServer: () => Promise<PageCollaborationServer>;
}

interface SeedSnapshotModule {
  runSeedSnapshotCli: (args: readonly string[]) => Promise<void>;
}

export const runPageCollaborationCli = async (
  args: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  loadPageCollaborationEnvironment();
  const seedMode = args.includes('--seed');
  const runtimeEntry = await buildPageCollaborationBundle(seedMode ? 'seed' : 'relay');
  const runtimeDirectory = path.dirname(fileURLToPath(runtimeEntry));
  let cleaned = false;
  const cleanupRuntime = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(runtimeDirectory, { force: true, recursive: true }).catch(() => undefined);
  };

  try {
    const runtimeModule = (await import(
      runtimeEntry.href
    )) as unknown as PageCollaborationCompositionModule & SeedSnapshotModule;

    if (seedMode) {
      try {
        await runtimeModule.runSeedSnapshotCli(
          args.filter((argument) => argument !== '--seed' && argument !== '--'),
        );
      } finally {
        await cleanupRuntime();
      }
      return;
    }

    if (args.includes('--preflight')) {
      await cleanupRuntime();
      console.info('[page-collaboration] ESM composition preflight passed');
      return;
    }

    let server: PageCollaborationServer | undefined;
    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      let exitCode = 0;
      try {
        await server?.close();
        console.info(`[page-collaboration] closed after ${signal}`);
      } catch (error) {
        console.error('[page-collaboration] shutdown failed', error);
        exitCode = 1;
      } finally {
        await cleanupRuntime();
      }
      process.exit(exitCode);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    try {
      server = await runtimeModule.startPageCollaborationServer();
    } catch (error) {
      await cleanupRuntime();
      console.error('[page-collaboration] startup failed', error);
      process.exitCode = 1;
    }
  } catch (error) {
    await cleanupRuntime();
    throw error;
  }
};

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  runPageCollaborationCli().catch((error) => {
    console.error('[page-collaboration] launcher failed', error);
    process.exitCode = 1;
  });
}
