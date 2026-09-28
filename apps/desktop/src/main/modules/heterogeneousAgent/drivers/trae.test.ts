import { describe, expect, it, vi } from 'vitest';

import { getHeterogeneousAgentDriver } from '../index';
import type { PrepareProviderBindingContext } from '../types';
import { sanitizeTraeProviderBindingArgs, traeDriver } from './trae';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

const bindingContext = (): PrepareProviderBindingContext => ({
  args: [
    '--model',
    'stale-model',
    '--profile',
    'personal',
    '-c',
    'model_provider="other"',
    '-c',
    'model_reasoning_effort="high"',
  ],
  env: {
    KEEP_ME: 'yes',
    LOBEHUB_TRAE_API_KEY: 'stale-host-key',
    OPENAI_API_KEY: 'stale-openai-key',
    TRAE_HOME: '/user/trae',
  },
  profileDir: '/managed/trae',
  reference: {
    apiConfig: { model: 'bound-model', providerId: 'responses-provider' },
    kind: 'provider',
  },
  resolution: {
    agentType: 'trae',
    apiConfig: { model: 'bound-model', providerId: 'responses-provider' },
    endpoint: 'https://responses.example.com/v1',
    protocol: 'openai-responses',
    providerId: 'responses-provider',
    runtimeConfig: {
      config: { enableResponseApi: true },
      keyVaults: { apiKey: 'bound-key', baseURL: 'https://responses.example.com/v1' },
      settings: { sdkType: 'openai', supportResponsesApi: true },
    },
  },
  runDir: '/managed/run',
});

describe('traeDriver', () => {
  it('is registered and preserves user ACP Server argument placement', async () => {
    expect(getHeterogeneousAgentDriver('trae')).toBe(traeDriver);

    await expect(
      traeDriver.buildSpawnPlan({
        args: ['--feature=test'],
        helpers: { buildAgentInput: async () => ({ args: [], stdin: '' }) },
        promptInput: 'hello',
      }),
    ).resolves.toEqual({ args: ['acp', 'serve', '--yolo', '--feature=test'] });
  });

  it('applies a secret-free Responses provider override and preserves TRAE identity auth', async () => {
    const plan = await traeDriver.prepareProviderBinding!(bindingContext());

    expect(plan.args).toEqual([
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'model="bound-model"',
      '-c',
      'model_provider="lobehub"',
      '-c',
      'model_providers.lobehub.name="LobeHub Provider"',
      '-c',
      'model_providers.lobehub.base_url="https://responses.example.com/v1"',
      '-c',
      'model_providers.lobehub.env_key="LOBEHUB_TRAE_API_KEY"',
      '-c',
      'model_providers.lobehub.wire_api="responses"',
      '-c',
      'model_providers.lobehub.requires_openai_auth=false',
    ]);
    expect(plan.env).toEqual({
      KEEP_ME: 'yes',
      LOBEHUB_TRAE_API_KEY: 'bound-key',
      TRAE_HOME: '/user/trae',
    });
    expect(plan.args.join(' ')).not.toContain('bound-key');
    expect(plan.profileFiles).toBeUndefined();
  });

  it('overrides the server-default provider without persisting the operation token', async () => {
    const plan = await traeDriver.prepareServerDefaultBinding!({
      args: ['--profile', 'stale', '--permission-mode', 'auto'],
      endpoint: 'https://app.example.com/',
      env: { LOBEHUB_TRAE_API_KEY: 'stale-token', TRAE_HOME: '/user/trae' },
      model: 'gpt-5.4',
      profileDir: '/managed/trae',
    });
    expect(plan.args).toEqual([
      '--permission-mode',
      'auto',
      '-c',
      'model="lobehub/gpt-5.4"',
      '-c',
      'model_provider="lobehub"',
      '-c',
      'model_providers.lobehub.name="LobeHub Provider"',
      '-c',
      'model_providers.lobehub.base_url="https://app.example.com/api/v1/openai/v1"',
      '-c',
      'model_providers.lobehub.env_key="LOBEHUB_TRAE_API_KEY"',
      '-c',
      'model_providers.lobehub.wire_api="responses"',
      '-c',
      'model_providers.lobehub.requires_openai_auth=false',
    ]);
    expect(plan.env).toEqual({ TRAE_HOME: '/user/trae' });
    expect(plan.operationTokenEnvKey).toBe('LOBEHUB_TRAE_API_KEY');
    expect(plan.args.join(' ')).not.toContain('stale-token');
    expect(plan.profileFiles).toBeUndefined();
  });

  it('removes only host-authoritative provider/model arguments', () => {
    expect(
      sanitizeTraeProviderBindingArgs([
        '-m=old',
        '--profile=personal',
        '--config=model=old',
        '-c',
        'model_providers.other.base_url="https://other"',
        '-c',
        'model_reasoning_effort="high"',
      ]),
    ).toEqual(['-c', 'model_reasoning_effort="high"']);
  });

  it('rejects a binding without Responses transport or credentials', async () => {
    const chatContext = bindingContext();
    chatContext.resolution.protocol = 'openai-chat-completions';
    expect(() => traeDriver.prepareProviderBinding!(chatContext)).toThrow(
      'TRAE provider binding requires a Responses API endpoint.',
    );

    const withoutKey = bindingContext();
    withoutKey.resolution.runtimeConfig.keyVaults.apiKey = ' ';
    expect(() => traeDriver.prepareProviderBinding!(withoutKey)).toThrow(
      'TRAE provider binding requires an API key.',
    );
  });
});
