import { describe, expect, it } from 'vitest';

import { findForbiddenModules } from './gate.mjs';

const root = '/repo';

describe('findForbiddenModules', () => {
  it('flags app services, the tRPC client, app stores and the flow graph library', () => {
    expect(
      findForbiddenModules(
        [
          '/repo/src/services/artboard.ts',
          '/repo/src/libs/trpc/client/lambda.ts',
          '/repo/src/store/user/index.ts',
          '/repo/node_modules/@xyflow/react/dist/esm/index.js',
        ],
        root,
      ),
    ).toEqual([
      'src/services/artboard.ts',
      'src/libs/trpc/client/lambda.ts',
      'src/store/user/index.ts',
      'node_modules/@xyflow/react/dist/esm/index.js',
    ]);
  });

  it('allows the board view, its local store and the store middleware', () => {
    expect(
      findForbiddenModules(
        [
          '/repo/src/features/Artboard/Viewport/index.tsx',
          '/repo/src/features/Artboard/store/store.ts',
          '/repo/src/store/middleware/createDevtools.ts',
          '\0vite/preload-helper',
        ],
        root,
      ),
    ).toEqual([]);
  });
});
