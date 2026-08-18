import { describe, expect, it } from 'vitest';

import type { App } from '@/core/App';

import BinaryCtr from '../BinaryCtr';

describe('BinaryCtr', () => {
  it('reports a bundled local runtime as available without probing an external binary', async () => {
    const controller = new BinaryCtr({} as App);

    await expect(
      controller.detectHeterogeneousAgentCommand({
        agentType: 'deepseek-harness',
        command: 'dsh',
      }),
    ).resolves.toEqual({ available: true });
  });
});
