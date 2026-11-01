import { describe, expect, it } from 'vitest';

import { buildInheritedSpawnEnv } from '../HeterogeneousAgentImpl';

describe('buildInheritedSpawnEnv', () => {
  it('drops host Anthropic creds and an ancestor agent run identity', () => {
    // A Desktop launched from a Codex shell inherits that run's JWT file; every agent it
    // spawns (and the shared Codex app-server) would hand nested `lh` the ancestor token.
    const env = buildInheritedSpawnEnv({
      ANTHROPIC_API_KEY: 'host-key',
      HOME: '/home/u',
      LOBEHUB_JWT_FILE: '/tmp/ancestor/jwt',
      LOBEHUB_TASK_ID: 'ancestor-task',
      PATH: '/usr/bin',
    });

    expect(env).toEqual({ HOME: '/home/u', PATH: '/usr/bin' });
  });
});
