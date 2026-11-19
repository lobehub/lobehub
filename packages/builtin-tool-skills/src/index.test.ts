import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { expect, it } from 'vitest';

import { vitePlatformResolve } from '../../../plugins/vite/platformResolve';

it.each(['web', 'desktop'] as const)(
  'bundles the public Skills prompts for %s',
  async (platform) => {
    const result = await build({
      build: {
        lib: { entry: fileURLToPath(new URL('./index.ts', import.meta.url)), formats: ['es'] },
        write: false,
      },
      configFile: false,
      logLevel: 'silent',
      plugins: [vitePlatformResolve(platform)],
    });

    const bundle = Array.isArray(result) ? result[0] : result;
    expect(bundle).toMatchObject({
      output: expect.arrayContaining([
        expect.objectContaining({
          exports: expect.arrayContaining(['deviceSystemPrompt', 'systemPrompt']),
          isEntry: true,
        }),
      ]),
    });
  },
);
