import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectStubUsage,
  parseStubSurface,
  reportStubSurfaceGaps,
  stubUsageGaps,
} from './surface';

const stubDir = import.meta.dirname;

describe('workbench stub surface', () => {
  it('treats reject() and createTRPCClient() as open members', () => {
    const surface = parseStubSurface(
      readFileSync(path.join(stubDir, 'trpcClient.client.ts'), 'utf8'),
    );

    expect([...surface.exports].sort()).toEqual([
      'asyncClient',
      'lambdaClient',
      'lambdaQuery',
      'toolsClient',
    ]);
    expect(surface.open.has('lambdaClient')).toBe(true);

    expect(
      stubUsageGaps(
        surface,
        collectStubUsage(
          `import { lambdaClient, createWorkspaceLambdaClient } from '@/libs/trpc/client';
           void lambdaClient.verify.getBundle.query();
           void createWorkspaceLambdaClient('ws');`,
          '@/libs/trpc/client',
        )!,
      ),
    ).toEqual(['createWorkspaceLambdaClient']);
  });

  it('reports a store method the simplified stub does not implement', () => {
    const surface = parseStubSurface(readFileSync(path.join(stubDir, 'fileStore.ts'), 'utf8'));
    const usage = collectStubUsage(
      `import { useFileStore } from '@/store/file';
       const removeFile = useFileStore((s) => s.removeFile);`,
      '@/store/file',
    );

    expect(stubUsageGaps(surface, usage!)).toEqual(['useFileStore.removeFile']);
    expect(
      stubUsageGaps(
        surface,
        collectStubUsage(
          `import { useFileStore } from '@/store/file';
           const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);`,
          '@/store/file',
        )!,
      ),
    ).toEqual([]);
  });

  it('allows implemented hook members and ignores type-only imports', () => {
    const surface = parseStubSurface(readFileSync(path.join(stubDir, 'electronStore.ts'), 'utf8'));
    const usage = collectStubUsage(
      `import type { ElectronStore } from '@/store/electron';
       import { getElectronStoreState, useElectronStore } from '@/store/electron';
       const state = useElectronStore.getState();
       void getElectronStoreState();`,
      '@/store/electron',
    );

    expect(stubUsageGaps(surface, usage!)).toEqual([]);
  });

  it('does not treat a catch-all selector proxy as covering new methods', () => {
    const surface = parseStubSurface(`
      export const fileChatSelectors = new Proxy({}, { get: () => () => undefined });
    `);
    const usage = collectStubUsage(
      `import { fileChatSelectors } from '@/store/file';
       fileChatSelectors.chatUploadFileList(state);`,
      '@/store/file',
    );

    expect(stubUsageGaps(surface, usage!)).toEqual(['fileChatSelectors.chatUploadFileList']);
  });

  it('covers the file-store surface the tree store reaches through the ResourceManager store', () => {
    // The tree store imports the ResourceManager store barrel to refresh the
    // sidebar search, which pulls these modules into the workbench SSR graph.
    const stub = readFileSync(path.join(stubDir, 'fileStore.ts'), 'utf8');
    const storeDir = path.resolve(stubDir, '../../../../src/features/ResourceManager/store');
    const files = ['action.ts', 'index.ts', 'selectors.ts'].map((name) => ({
      rel: `src/features/ResourceManager/store/${name}`,
      source: readFileSync(path.join(storeDir, name), 'utf8'),
    }));

    expect(reportStubSurfaceGaps(files, [{ source: stub, specifier: '@/store/file' }])).toEqual([]);
  });

  it('formats graph gaps with the importer path', () => {
    expect(
      reportStubSurfaceGaps(
        [
          {
            rel: 'src/features/Acceptance/Viewer/Evidence/attachments.tsx',
            source: `import { useFileStore } from '@/store/file';
                     const removeFile = useFileStore((s) => s.removeFile);`,
          },
        ],
        [
          {
            source: readFileSync(path.join(stubDir, 'fileStore.ts'), 'utf8'),
            specifier: '@/store/file',
          },
        ],
      ),
    ).toEqual([
      '  src/features/Acceptance/Viewer/Evidence/attachments.tsx\n    @/store/file: useFileStore.removeFile',
    ]);
  });
});
