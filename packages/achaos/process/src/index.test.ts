import type { ChaosRunContext } from '@achaos/core';
import { describe, expect, it, vi } from 'vitest';

import { createProcessChaosAdapter } from '.';

describe('createProcessChaosAdapter', () => {
  it('rejects non-terminating signals from programmatic callers', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const adapter = createProcessChaosAdapter({ allowedPids: new Set([123]) });
    const context = {
      experiment: {
        effect: { signal: 'SIGSTOP', type: 'kill_process' },
        safety: { destructive: true },
        target: { selector: { pid: 123 } },
      },
      runId: 'run-process',
    } as unknown as ChaosRunContext;
    await expect(adapter.inject(context)).rejects.toThrow('non-terminating signal SIGSTOP');
    expect(kill).not.toHaveBeenCalled();
  });
});
