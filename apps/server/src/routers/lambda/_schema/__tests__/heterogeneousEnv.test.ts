// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentQuotaRouter } from '../../agentQuota';
import { deviceRouter } from '../../device';
import { heterogeneousEnvSchema } from '../heterogeneousEnv';

// A stored agent env as a deep-merged `null` patch leaves it.
const storedEnv = {
  CLAUDE_CODE_ENTRYPOINT: 'lobehub',
  CLAUDE_CONFIG_DIR: null,
  GITHUB_CRED_KEY: '',
};

describe('heterogeneousEnvSchema', () => {
  it('drops null entries and keeps every string, empty ones included', () => {
    expect(heterogeneousEnvSchema.parse(storedEnv)).toEqual({
      CLAUDE_CODE_ENTRYPOINT: 'lobehub',
      GITHUB_CRED_KEY: '',
    });
  });

  it('still rejects values that are neither strings nor null', () => {
    expect(heterogeneousEnvSchema.safeParse({ A: 1 }).success).toBe(false);
  });
});

/**
 * The quota panel forwards the agent's stored env verbatim. A schema that
 * rejected `null` failed the request before it reached the device, so the
 * panel showed a bare "Quota is unavailable".
 */
describe('device RPC inputs accept a stored env with null entries', () => {
  const parseInput = (procedure: any, input: unknown) => procedure._def.inputs[0].parse(input);
  const deviceProcedures = (deviceRouter as any)._def.procedures;
  const quotaProcedures = (agentQuotaRouter as any)._def.procedures;

  it.each([
    ['device.getClaudeCodeQuota', () => deviceProcedures.getClaudeCodeQuota, {}],
    [
      'device.listHeterogeneousAgentModels',
      () => deviceProcedures.listHeterogeneousAgentModels,
      { type: 'codex' },
    ],
    ['agentQuota.refreshCodexQuota', () => quotaProcedures.refreshCodexQuota, {}],
    ['agentQuota.refreshKimiCodeQuota', () => quotaProcedures.refreshKimiCodeQuota, {}],
  ])('%s', (_name, getProcedure, extra) => {
    const parsed = parseInput(getProcedure(), { deviceId: 'device-1', env: storedEnv, ...extra });

    expect(parsed.env).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'lobehub', GITHUB_CRED_KEY: '' });
  });
});
