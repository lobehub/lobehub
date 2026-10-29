import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { copilotDriver } from './copilot';

const helpers = { buildAgentInput: async () => ({ args: [], stdin: '' }) };

describe('copilotDriver', () => {
  it('is registered and builds the fixed ACP server command', async () => {
    expect(getHeterogeneousAgentDriver('copilot')).toBe(copilotDriver);

    await expect(
      copilotDriver.buildSpawnPlan({
        args: ['--add-dir', '/repo'],
        helpers,
        promptInput: 'hello',
      }),
    ).resolves.toEqual({ args: ['--acp', '--add-dir', '/repo'] });
  });

  it.each(['--yolo', '--allow-all-tools', '--resume=abc', '-p'])(
    'rejects %s, which would bypass the host-owned ACP lifecycle or permission prompts',
    async (argument) => {
      await expect(
        copilotDriver.buildSpawnPlan({ args: [argument], helpers, promptInput: 'hello' }),
      ).rejects.toThrow('does not support CLI argument');
    },
  );

  it('binds a server-default model to the LobeHub Anthropic relay in offline mode', async () => {
    const plan = await copilotDriver.prepareServerDefaultBinding!({
      args: ['--model', 'gpt-5.4', '--add-dir', '/repo', '--model=claude-haiku-4.5'],
      endpoint: 'https://lobehub.test',
      env: {
        COPILOT_HOME: '/home/user/.copilot',
        COPILOT_MODEL: 'gpt-5.4',
        COPILOT_OFFLINE: 'false',
        COPILOT_PROVIDER_API_KEY: 'stale-token',
        COPILOT_PROVIDER_API_KEY_COMMAND: 'print-key',
        COPILOT_PROVIDER_BEARER_TOKEN: 'user-byok-token',
        COPILOT_PROVIDER_HEADERS: 'Authorization: Bearer user',
        COPILOT_PROVIDER_WIRE_MODEL: 'gpt-5.4',
        GH_TOKEN: 'github-identity',
      },
      model: 'claude-sonnet-4-6',
      modelDescriptor: {
        abilities: { reasoning: true, vision: true },
        maxOutput: 64_000,
        model: 'claude-sonnet-4-6',
        nativeResponses: false,
      },
      profileDir: '/managed/copilot',
    });

    expect(plan.args).toEqual(['--add-dir', '/repo']);
    expect(plan.env).toEqual({
      COPILOT_HOME: '/managed/copilot',
      COPILOT_MODEL: 'lobehub/claude-sonnet-4-6',
      COPILOT_OFFLINE: 'true',
      COPILOT_PROVIDER_BASE_URL: 'https://lobehub.test/api/v1/anthropic',
      COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: '64000',
      COPILOT_PROVIDER_TYPE: 'anthropic',
      GH_TOKEN: 'github-identity',
    });
    // The host injects the per-prompt operation token here after the env merge.
    expect(plan.operationTokenEnvKey).toBe('COPILOT_PROVIDER_API_KEY');
    // `session/set_model` replaces COPILOT_MODEL, so it must select the same request model.
    expect(plan.model).toBe('lobehub/claude-sonnet-4-6');
    expect(plan.ownsEnvKey!('COPILOT_PROVIDER_BEARER_TOKEN')).toBe(true);
    expect(plan.ownsEnvKey!('COPILOT_HOME')).toBe(true);
    expect(plan.ownsEnvKey!('GH_TOKEN')).toBe(false);
    await expect(
      copilotDriver.buildSpawnPlan({ args: plan.args, helpers, promptInput: 'hello' }),
    ).resolves.toEqual({ args: ['--acp', '--add-dir', '/repo'] });
  });

  it('leaves the output budget to Copilot when the model card is unavailable', async () => {
    const plan = await copilotDriver.prepareServerDefaultBinding!({
      args: [],
      endpoint: 'https://lobehub.test',
      model: 'kimi-k3',
      profileDir: '/managed/copilot',
    });

    expect(plan.env).not.toHaveProperty('COPILOT_PROVIDER_MAX_OUTPUT_TOKENS');
    expect(plan.env.COPILOT_MODEL).toBe('lobehub/kimi-k3');
  });
});
