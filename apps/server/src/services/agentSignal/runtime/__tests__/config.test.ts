import { describe, expect, it } from 'vitest';

import { resolveAgentSignalRuntimeConfig } from '../config';

describe('agent signal runtime config', () => {
  /**
   * @example
   * const config = resolveAgentSignalRuntimeConfig({
   *   enableAgentSignalRuntime: false,
   *   enableDurableRuntime: false,
   * });
   *
   * expect(config.runtimeEnabled).toBe(false);
   */
  it('disables runtime emission when the backend env flag is off', () => {
    const config = resolveAgentSignalRuntimeConfig({
      enableAgentSignalRuntime: false,
      enableDurableRuntime: false,
    });

    expect(config).toEqual({
      backend: 'memory',
      durableRuntimeEnabled: false,
      runtimeEnabled: false,
    });
  });

  /**
   * @example
   * const config = resolveAgentSignalRuntimeConfig({
   *   enableAgentSignalRuntime: true,
   *   enableDurableRuntime: true,
   * });
   *
   * expect(config.durableRuntimeEnabled).toBe(true);
   */
  it('requires both flags before durable runtime is enabled', () => {
    expect(
      resolveAgentSignalRuntimeConfig({
        enableAgentSignalRuntime: true,
        enableDurableRuntime: false,
      }),
    ).toEqual({
      backend: 'memory',
      durableRuntimeEnabled: false,
      runtimeEnabled: true,
    });

    expect(
      resolveAgentSignalRuntimeConfig({
        enableAgentSignalRuntime: true,
        enableDurableRuntime: true,
      }),
    ).toEqual({
      backend: 'memory',
      durableRuntimeEnabled: true,
      runtimeEnabled: true,
    });
  });
});
