import { describe, expect, it } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import { droidDriver } from './droid';

describe('droidDriver', () => {
  it('prepares a runtime-only Anthropic model with an environment credential reference', async () => {
    const plan = await droidDriver.prepareServerDefaultBinding!({
      args: [
        '--settings',
        '/other/settings.json',
        '--settings=/another/settings.json',
        '--tag',
        'keep',
      ],
      endpoint: 'https://example.test',
      env: { FACTORY_API_KEY: 'native-identity', LOBEHUB_DROID_API_KEY: 'stale-token' },
      model: 'vendor/model',
      modelDescriptor: {
        abilities: { reasoning: true, vision: true },
        maxOutput: 8192,
        model: 'vendor/model',
        nativeResponses: false,
      },
      profileDir: '/managed/droid',
    });
    expect(plan.args).toEqual(['--settings', '/managed/droid/settings.json', '--tag', 'keep']);
    expect(plan.model).toBe('custom:LobeHub-Server-Default-0');
    expect(plan.operationTokenEnvKey).toBe('LOBEHUB_DROID_API_KEY');
    expect(plan.env).toEqual({ FACTORY_API_KEY: 'native-identity' });
    expect(JSON.parse(plan.profileFiles![0].content)).toEqual({
      customModels: [
        {
          apiKey: '${LOBEHUB_DROID_API_KEY}',
          baseUrl: 'https://example.test/api/v1/anthropic',
          displayName: 'LobeHub Server Default',
          maxOutputTokens: 8192,
          model: 'lobehub/vendor/model',
          noImageSupport: false,
          provider: 'anthropic',
        },
      ],
    });
    expect(JSON.stringify(plan.profileFiles)).not.toContain('stale-token');
    expect(
      await droidDriver.buildSpawnPlan({
        args: plan.args,
        helpers: { buildAgentInput: async () => ({ args: [], stdin: undefined }) },
        promptInput: 'hi',
      }),
    ).toMatchObject({ args: ['exec', '--output-format', 'acp', ...plan.args] });
  });

  it('is registered and builds the fixed safe ACP command', async () => {
    expect(getHeterogeneousAgentDriver('droid')).toBe(droidDriver);

    await expect(
      droidDriver.buildSpawnPlan({
        args: ['--tag', 'lobe'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).resolves.toEqual({
      args: ['exec', '--output-format', 'acp', '--tag', 'lobe'],
    });

    await expect(
      droidDriver.buildSpawnPlan({
        args: ['--skip-permissions-unsafe'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).rejects.toThrow('does not support CLI argument');
  });
});
