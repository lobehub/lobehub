import type { ChaosRunContext } from '@achaos/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProcessChaosAdapter } from '.';

afterEach(() => vi.restoreAllMocks());

describe('createProcessChaosAdapter', () => {
  it('rejects process-group PID values before consulting the allowlist', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const adapter = createProcessChaosAdapter({ allowedPids: new Set([0, -123]) });
    for (const pid of [0, -123]) {
      const context = {
        experiment: {
          effect: { type: 'kill_process' },
          safety: { destructive: true },
          target: { selector: { pid } },
        },
        runId: 'run-process',
      } as unknown as ChaosRunContext;
      await expect(adapter.inject(context)).rejects.toThrow('positive integer pid');
    }
    expect(kill).not.toHaveBeenCalled();
  });

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
    await expect(adapter.inject(context)).rejects.toThrow('requires uncatchable SIGKILL');
    expect(kill).not.toHaveBeenCalled();
  });

  it('rejects catchable terminating signals', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const adapter = createProcessChaosAdapter({ allowedPids: new Set([123]) });
    const context = {
      experiment: {
        effect: { signal: 'SIGTERM', type: 'kill_process' },
        safety: { destructive: true },
        target: { selector: { pid: 123 } },
      },
      runId: 'run-process',
    } as unknown as ChaosRunContext;
    await expect(adapter.inject(context)).rejects.toThrow('requires uncatchable SIGKILL');
    expect(kill).not.toHaveBeenCalled();
  });
});
