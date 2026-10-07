import { describe, expect, it } from 'vitest';

import { withCodexThreadEnv } from './environment';

/** @example User shell configuration survives while old run IDs cannot override the current run. */
describe('Codex thread environment', () => {
  /** @example Nested and dotted config forms both receive the current operation. */
  it('preserves shell settings and prevents ancestor overrides from restoring stale provenance', () => {
    const params = {
      config: {
        'shell_environment_policy': {
          inherit: 'all',
          set: { EXTRA: 'kept', LOBEHUB_OPERATION_ID: 'old' },
        },
        'shell_environment_policy.set': { ANOTHER: 'kept', LOBEHUB_TOPIC_ID: 'old' },
        'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'old',
        'model_reasoning_effort': 'low',
      },
      cwd: '/workspace',
    };
    const result = withCodexThreadEnv(params, {
      LOBEHUB_OPERATION_ID: 'current',
      LOBEHUB_JWT: 'test-token',
    });
    /** @example Every accepted config spelling masks old provenance and preserves non-context settings. */
    expect(result.config).toMatchObject({
      'shell_environment_policy': {
        inherit: 'all',
        set: { EXTRA: 'kept', LOBEHUB_OPERATION_ID: 'current', LOBEHUB_TOPIC_ID: '' },
      },
      'shell_environment_policy.set': {
        ANOTHER: 'kept',
        LOBEHUB_TOPIC_ID: '',
        LOBEHUB_OPERATION_ID: 'current',
      },
      'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'current',
      'model_reasoning_effort': 'low',
    });
    /** @example Credentials never enter the per-thread RPC config. */
    expect(JSON.stringify(result)).not.toContain('test-token');
    /** @example Reusing caller config does not mutate its original values. */
    expect(params.config.shell_environment_policy.set.LOBEHUB_OPERATION_ID).toBe('old');
  });
});
