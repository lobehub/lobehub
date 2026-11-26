// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { it } from 'vitest';

import { vitePlatformResolve } from '../../../../plugins/vite/platformResolve';

it.each(['desktop', 'web'] as const)('bundles the navigation tracker for %s', async (platform) => {
  await build({
    build: {
      lib: {
        entry: fileURLToPath(new URL('./Tracker.tsx', import.meta.url)),
        formats: ['es'],
      },
      rolldownOptions: {
        external: (id) => id === 'react' || id.startsWith('react/') || id.startsWith('@/'),
      },
      write: false,
    },
    configFile: false,
    logLevel: 'error',
    plugins: [vitePlatformResolve(platform)],
  });
});
