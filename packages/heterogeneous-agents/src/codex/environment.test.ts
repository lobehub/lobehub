import { describe, expect, it } from 'vitest';

import { getCodexProcessEnv, pickCodexRunProvenance, withCodexThreadEnv } from './environment';

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
      LOBEHUB_WORKSPACE_ID: undefined,
    });
  });

  it('keeps the workspace out of the shared app-server process env', () => {
    // Runs from two workspaces must reuse one app-server; a workspace in the process env made
    // the reuse check reject the second run as a different environment.
    const launch = (workspace: string) =>
      getCodexProcessEnv({ CODEX_HOME: '/codex', LOBEHUB_WORKSPACE_ID: workspace });
    expect(launch('ws-a')).toEqual(launch('ws-b'));
    expect(launch('ws-a')).toEqual({ CODEX_HOME: '/codex' });
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
          LOBEHUB_WORKSPACE_ID: '',
        },
      },
    });
    expect(params.config.shell_environment_policy.set.LOBEHUB_OPERATION_ID).toBe('old');
  });
});
