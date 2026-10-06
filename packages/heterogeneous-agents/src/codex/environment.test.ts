import { describe, expect, it } from 'vitest';

import { pickCodexRunProvenance, withCodexThreadEnv } from './environment';

describe('Codex thread environment', () => {
  it('picks only run provenance from a launch environment', () => {
    expect(
      pickCodexRunProvenance({
        CODEX_HOME: '/codex',
        LOBEHUB_JWT: 'test-token',
        LOBEHUB_OPERATION_ID: 'op',
        LOBEHUB_TOPIC_ID: 'topic',
      }),
    ).toEqual({
      LOBEHUB_AGENT_ID: undefined,
      LOBEHUB_OPERATION_ID: 'op',
      LOBEHUB_TOPIC_ID: 'topic',
    });
  });

  it('folds every shell policy override into one table carrying the run provenance', () => {
    const params = {
      config: {
        'model_reasoning_effort': 'low',
        'shell_environment_policy': {
          inherit: 'all',
          set: { EXTRA: 'kept', LOBEHUB_OPERATION_ID: 'old' },
        },
        'shell_environment_policy.set': { ANOTHER: 'kept', LOBEHUB_TOPIC_ID: 'old' },
        'shell_environment_policy.set.LOBEHUB_OPERATION_ID': 'old',
        'shell_environment_policy.exclude': ['SECRET_*'],
      },
      cwd: '/workspace',
    };

    const result = withCodexThreadEnv(params, { LOBEHUB_OPERATION_ID: 'current' });

    // One key per subtree: Codex applies overrides in hash order, so a sibling spelling could
    // otherwise replace the run's IDs.
    expect(result.config).toEqual({
      model_reasoning_effort: 'low',
      shell_environment_policy: {
        exclude: ['SECRET_*'],
        inherit: 'all',
        set: {
          ANOTHER: 'kept',
          LOBEHUB_AGENT_ID: '',
          LOBEHUB_OPERATION_ID: 'current',
          LOBEHUB_TOPIC_ID: '',
        },
      },
    });
    expect(params.config.shell_environment_policy.set.LOBEHUB_OPERATION_ID).toBe('old');
  });
});
