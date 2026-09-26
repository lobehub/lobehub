import { describe, expect, it } from 'vitest';

import { scanSandbox } from './useAgentScan';

describe('scanSandbox', () => {
  it('reports the deployment’s agent types as available', () => {
    expect(scanSandbox(['opencode', 'codex'])).toEqual({
      codex: { available: true },
      opencode: { available: true },
    });
  });

  it('reports nothing when the deployment allows nothing', () => {
    expect(scanSandbox([])).toEqual({});
  });
});
