import path from 'node:path';

import { describe, expect, it } from 'vitest';

import viteMainConfig from './vite.main.config';

describe('vite main runtime entries', () => {
  it('emits the bundled DSH runtime and keeps its host package external', async () => {
    const config = await viteMainConfig({ command: 'build', mode: 'development' });
    const entry =
      config.build?.lib && 'entry' in config.build.lib ? config.build.lib.entry : undefined;
    const external = config.build?.rolldownOptions?.external;

    expect(entry).toMatchObject({
      dshRuntimeEntry: path.resolve(
        __dirname,
        '../../packages/heterogeneous-agents/src/spawn/dshRuntimeEntry.ts',
      ),
      index: path.resolve(__dirname, 'src/main/index.ts'),
    });
    expect(external).toContain('@deepseek-ai/dsh-app-boot');
  });
});
