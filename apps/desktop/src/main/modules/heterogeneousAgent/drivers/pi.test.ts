import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import type {
  HeterogeneousAgentBuildPlanHelpers,
  HeterogeneousAgentBuildPlanParams,
  PrepareProviderBindingContext,
} from '../types';
import { piDriver, sanitizePiProviderBindingArgs } from './pi';

const buildAgentInput = vi.fn(async () => ({
  args: ['@/tmp/image.png'],
  stdin: 'raw prompt',
}));
const helpers: HeterogeneousAgentBuildPlanHelpers = { buildAgentInput };

const buildParams = (
  overrides: Partial<HeterogeneousAgentBuildPlanParams> = {},
): HeterogeneousAgentBuildPlanParams => ({
  args: [],
  helpers,
  promptInput: 'raw prompt',
  ...overrides,
});

const bindingContext = (
  protocol: PrepareProviderBindingContext['resolution']['protocol'] = 'openai-chat-completions',
): PrepareProviderBindingContext => ({
  args: [
    '--provider',
    'stale-provider',
    '--model=stale-model',
    '--models',
    'other/*',
    '--api-key=argv-secret',
    '--session-dir',
    '/unmanaged/sessions',
    '--no-session',
    '--thinking',
    'high',
  ],
  env: {
    KEEP_ME: 'yes',
    LOBEHUB_PI_API_KEY: 'stale-key',
    PI_CODING_AGENT_DIR: '/user/pi',
    PI_CODING_AGENT_SESSION_DIR: '/user/sessions',
  },
  profileDir: '/managed/pi/profile-digest',
  reference: {
    apiConfig: { model: 'vendor/model-test', providerId: 'provider-test' },
    kind: 'provider',
  },
  resolution: {
    agentType: 'pi',
    apiConfig: { model: 'vendor/model-test', providerId: 'provider-test' },
    endpoint: 'https://gateway.example.com/v1',
    modelMetadata: {
      abilities: { reasoning: true, vision: true },
      contextWindowTokens: 200_000,
      displayName: 'Provider model',
      id: 'vendor/model-test',
      maxOutput: 32_000,
      providerId: 'provider-test',
      type: 'chat',
    },
    protocol,
    providerId: 'provider-test',
    runtimeConfig: {
      config: {},
      keyVaults: { apiKey: 'bound-key', baseURL: 'https://gateway.example.com/v1' },
      settings: { sdkType: 'openai' },
    },
  },
  runDir: '/managed/run',
});

describe('piDriver', () => {
  it('writes a secret-free server-default Responses profile', async () => {
    const plan = await piDriver.prepareServerDefaultBinding!({
      args: ['--provider', 'stale', '--thinking', 'high'],
      endpoint: 'https://app.example.com',
      env: { LOBEHUB_PI_API_KEY: 'stale-token' },
      model: 'kimi-k2.6',
      profileDir: '/managed/pi',
    });
    const content = plan.profileFiles?.[0]?.content ?? '';
    const config = JSON.parse(content);
    const provider = config.providers['lobehub-server-default'];

    expect(plan.args).toEqual([
      '--provider',
      'lobehub-server-default',
      '--model',
      'lobehub/kimi-k2.6',
      '--thinking',
      'high',
    ]);
    expect(plan.env).toEqual({ PI_CODING_AGENT_DIR: '/managed/pi' });
    expect(plan.operationTokenEnvKey).toBe('LOBEHUB_PI_API_KEY');
    expect(provider).toMatchObject({
      api: 'openai-responses',
      apiKey: '$LOBEHUB_PI_API_KEY',
      baseUrl: 'https://app.example.com/api/v1/openai/v1',
      models: [
        {
          contextWindow: 128_000,
          id: 'lobehub/kimi-k2.6',
          maxTokens: 16_384,
        },
      ],
    });
    expect(content).not.toContain('stale-token');
  });

  it('is registered and composes base, resume, configured, and input args in order', async () => {
    expect(getHeterogeneousAgentDriver('pi')).toBe(piDriver);

    const plan = await piDriver.buildSpawnPlan(
      buildParams({ args: ['--provider', 'anthropic'], resumeSessionId: 'pi-session-exact' }),
    );

    expect(buildAgentInput).toHaveBeenCalledWith('pi', 'raw prompt');
    expect(plan).toEqual({
      args: [
        '--mode',
        'json',
        '--session-id',
        'pi-session-exact',
        '--provider',
        'anthropic',
        '@/tmp/image.png',
      ],
      stdinPayload: 'raw prompt',
    });
  });

  it.each([
    ['openai-chat-completions', 'openai-completions'],
    ['openai-responses', 'openai-responses'],
    ['anthropic-messages', 'anthropic-messages'],
    ['google-generative-ai', 'google-generative-ai'],
  ] as const)('maps %s to the Pi custom-provider API %s', async (protocol, expectedApi) => {
    const plan = await piDriver.prepareProviderBinding!(bindingContext(protocol));
    const config = JSON.parse(plan.profileFiles?.[0]?.content ?? '{}');

    expect(config.providers['lobehub-profile-digest'].api).toBe(expectedApi);
  });

  it('writes a secret-free managed profile and forces its provider/model through env and argv', async () => {
    const plan = await piDriver.prepareProviderBinding!(bindingContext());
    const content = plan.profileFiles?.[0]?.content ?? '';
    const config = JSON.parse(content);
    const provider = config.providers['lobehub-profile-digest'];

    expect(plan.args).toEqual([
      '--provider',
      'lobehub-profile-digest',
      '--model',
      'vendor/model-test',
      '--thinking',
      'high',
    ]);
    expect(plan.env).toEqual({
      KEEP_ME: 'yes',
      LOBEHUB_PI_API_KEY: 'bound-key',
      PI_CODING_AGENT_DIR: '/managed/pi/profile-digest',
    });
    expect(plan.profileFiles?.[0]?.path).toBe('models.json');
    expect(provider).toMatchObject({
      api: 'openai-completions',
      apiKey: '$LOBEHUB_PI_API_KEY',
      baseUrl: 'https://gateway.example.com/v1',
      models: [
        {
          contextWindow: 200_000,
          id: 'vendor/model-test',
          input: ['text', 'image'],
          maxTokens: 32_000,
          name: 'Provider model',
          reasoning: true,
        },
      ],
      name: 'LobeHub Provider',
    });
    expect(content).not.toContain('bound-key');
    expect(content).not.toContain('argv-secret');

    const spawnPlan = await piDriver.buildSpawnPlan(
      buildParams({ args: plan.args, resumeSessionId: 'pi-session-exact' }),
    );
    expect(spawnPlan.args).toEqual([
      '--mode',
      'json',
      '--session-id',
      'pi-session-exact',
      '--provider',
      'lobehub-profile-digest',
      '--model',
      'vendor/model-test',
      '--thinking',
      'high',
      '@/tmp/image.png',
    ]);
  });

  it('uses conservative Pi metadata defaults when server model metadata is unavailable', async () => {
    const context = bindingContext();
    context.resolution.modelMetadata = undefined;
    const plan = await piDriver.prepareProviderBinding!(context);
    const config = JSON.parse(plan.profileFiles?.[0]?.content ?? '{}');
    const model = config.providers['lobehub-profile-digest'].models[0];

    expect(model).toMatchObject({
      contextWindow: 128_000,
      input: ['text'],
      maxTokens: 16_384,
      reasoning: false,
    });
  });

  it('removes binding and session overrides without removing unrelated args', () => {
    expect(
      sanitizePiProviderBindingArgs([
        '--provider=other',
        '--model',
        'old',
        '--models=one,two',
        '--api-key',
        'secret',
        '--session',
        'other-session',
        '--session-id=other-id',
        '--fork',
        'fork-source',
        '--session-dir=/tmp/sessions',
        '--continue',
        '-c',
        '--resume',
        '-r',
        '--no-session',
        '--thinking=low',
      ]),
    ).toEqual(['--thinking=low']);
  });

  it('keeps managed routing effective before a caller option terminator', async () => {
    const context = bindingContext();
    context.args = ['--', '--provider', 'message-provider'];

    const plan = await piDriver.prepareProviderBinding!(context);
    const spawnPlan = await piDriver.buildSpawnPlan(buildParams({ args: plan.args }));

    expect(spawnPlan.args).toEqual([
      '--mode',
      'json',
      '--provider',
      'lobehub-profile-digest',
      '--model',
      'vendor/model-test',
      '--',
      '@/tmp/image.png',
    ]);
  });

  it('rejects a binding without an endpoint or API key', () => {
    const withoutEndpoint = bindingContext();
    withoutEndpoint.resolution.endpoint = undefined;
    expect(() => piDriver.prepareProviderBinding!(withoutEndpoint)).toThrow(
      'Pi provider binding requires an API endpoint.',
    );

    const withoutKey = bindingContext();
    withoutKey.resolution.runtimeConfig.keyVaults = {};
    expect(() => piDriver.prepareProviderBinding!(withoutKey)).toThrow(
      'Pi provider binding requires an API key.',
    );
  });
});
