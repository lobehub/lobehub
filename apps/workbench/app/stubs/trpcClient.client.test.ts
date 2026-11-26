import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as ssrShim from './trpcClient';
import * as clientShim from './trpcClient.client';

const source = readFileSync(path.join(import.meta.dirname, 'trpcClient.client.ts'), 'utf8');

describe('workbench client lambda shim', () => {
  it.each([
    ['client', clientShim],
    ['SSR', ssrShim],
  ] as const)('rejects the unsupported workspace chat client factory in %s', (_surface, shim) => {
    expect(() => Reflect.apply(shim.createWorkspaceLambdaClient, undefined, ['workspace'])).toThrow(
      'createWorkspaceLambdaClient is not available during SSR',
    );
  });

  it.each(['@/store/image', '@/store/chat', '@/services/_auth', '@/store/user', 'model-bank'])(
    'does not import %s',
    (needle) => {
      expect(source).not.toContain(needle);
    },
  );

  it('sends cookies and skips the image-page header stack', () => {
    expect(source).toContain("credentials: 'include'");
    expect(source).toContain("url: '/trpc/lambda'");
  });
});
