import { describe, expect, it } from 'vitest';

import type { PrepareProviderBindingContext } from '../types';
import { grokBuildDriver, sanitizeGrokProviderBindingArgs } from './grokBuild';

const bindingContext = (
  protocol: PrepareProviderBindingContext['resolution']['protocol'],
  endpoint: string,
): PrepareProviderBindingContext => ({
  args: [
    '--model',
    'stale-model',
    '--agent=untrusted-agent',
    '--agent-profile',
    '/untrusted/profile',
    '--continue',
    '--effort',
    'high',
  ],
  env: {
    GROK_CONFIG: 'untrusted config',
    GROK_DEFAULT_MODEL: 'stale-model',
    GROK_HOME: '/user/grok',
    GROK_CODE_XAI_API_KEY: 'stale-legacy-key',
    KEEP_ME: 'yes',
    LOBEHUB_GROK_API_KEY: 'stale-key',
    XAI_API_KEY: 'stale-xai-key',
  },
  profileDir: '/managed/grok',
  reference: {
    apiConfig: { model: 'bound-model', providerId: 'provider-test' },
    kind: 'provider',
  },
  resolution: {
    agentType: 'grok-build',
    apiConfig: { model: 'bound-model', providerId: 'provider-test' },
    endpoint,
    protocol,
    providerId: 'provider-test',
    runtimeConfig: {
      config: {},
      keyVaults: { apiKey: 'bound-key', baseURL: endpoint },
      settings: {
        sdkType: protocol === 'anthropic-messages' ? 'anthropic' : 'openai',
        supportResponsesApi: protocol === 'openai-responses',
      },
    },
  },
  runDir: '/managed/run',
});

describe('grokBuildDriver provider binding', () => {
  it('writes a secret-free server-default Responses profile', async () => {
    const plan = await grokBuildDriver.prepareServerDefaultBinding!({
      args: ['--model', 'stale-model', '--effort', 'high'],
      endpoint: 'https://app.example.com/',
      env: { LOBEHUB_GROK_API_KEY: 'stale-token' },
      model: 'kimi-k2.6',
      profileDir: '/managed/grok',
    });
    const config = plan.profileFiles?.[0]?.content ?? '';
    const alias = plan.args.at(-1);

    expect(plan.args).toEqual(['--effort', 'high', '--model', alias]);
    expect(alias).toMatch(/^lobehub-provider-[\da-f]{16}$/);
    expect(plan.env).toMatchObject({ GROK_HOME: '/managed/grok' });
    expect(plan.env.LOBEHUB_GROK_API_KEY).toBeUndefined();
    expect(plan.operationTokenEnvKey).toBe('LOBEHUB_GROK_API_KEY');
    expect(config).toContain('model = "lobehub/kimi-k2.6"');
    expect(config).toContain('base_url = "https://app.example.com/api/v1/openai/v1"');
    expect(config).toContain('api_backend = "responses"');
    expect(config).toContain('auth_scheme = "bearer"');
    expect(config).not.toContain('stale-token');
  });

  it.each([
    [
      'openai-chat-completions',
      'https://gateway.example.com/v1/chat/completions/',
      'chat_completions',
      'https://gateway.example.com/v1',
      'bearer',
    ],
    [
      'openai-responses',
      'https://gateway.example.com/v1/responses/',
      'responses',
      'https://gateway.example.com/v1',
      'bearer',
    ],
    [
      'anthropic-messages',
      'https://gateway.example.com/anthropic/v1/messages/',
      'messages',
      'https://gateway.example.com/anthropic/v1',
      'x_api_key',
    ],
  ] as const)(
    'writes a secret-free %s profile and pins its managed alias',
    async (protocol, endpoint, apiBackend, baseURL, authScheme) => {
      const plan = await grokBuildDriver.prepareProviderBinding!(
        bindingContext(protocol, endpoint),
      );
      const config = plan.profileFiles?.[0]?.content ?? '';
      const alias = plan.args.at(-1);

      expect(plan.args).toEqual(['--effort', 'high', '--model', alias]);
      expect(alias).toMatch(/^lobehub-provider-[\da-f]{16}$/);
      expect(plan.env).toMatchObject({
        GROK_AGENT: '',
        GROK_CONFIG: '',
        GROK_CONFIG_PATH: '',
        GROK_DEFAULT_MODEL: '',
        GROK_HOME: '/managed/grok',
        KEEP_ME: 'yes',
        LOBEHUB_GROK_API_KEY: 'bound-key',
      });
      expect(plan.env.GROK_CODE_XAI_API_KEY).toBeUndefined();
      expect(plan.env.XAI_API_KEY).toBeUndefined();
      expect(config).toContain(`[model.${alias}]`);
      expect(config).toContain('model = "bound-model"');
      expect(config).toContain(`base_url = "${baseURL}"`);
      expect(config).toContain('env_key = "LOBEHUB_GROK_API_KEY"');
      expect(config).toContain(`api_backend = "${apiBackend}"`);
      expect(config).toContain(`auth_scheme = "${authScheme}"`);
      expect(config).toContain(`default = "${alias}"`);
      expect(config).not.toContain('bound-key');
      expect(config).not.toContain('stale-key');

      if (protocol === 'anthropic-messages') {
        expect(config).toContain('extra_headers = { "anthropic-version" = "2023-06-01" }');
      } else {
        expect(config).not.toContain('anthropic-version');
      }
    },
  );

  it('adds the Anthropic SDK v1 segment when the configured base URL omits it', async () => {
    const plan = await grokBuildDriver.prepareProviderBinding!(
      bindingContext('anthropic-messages', 'https://api.anthropic.com'),
    );

    expect(plan.profileFiles?.[0]?.content).toContain('base_url = "https://api.anthropic.com/v1"');
  });

  it('removes model, profile, agent, and resume overrides while preserving unrelated options', () => {
    expect(
      sanitizeGrokProviderBindingArgs([
        '-m=old',
        '--agent',
        'untrusted',
        '--agent-profile=/untrusted',
        '--resume',
        'old-session',
        '--session-id=other-session',
        '-c',
        '--effort',
        'xhigh',
      ]),
    ).toEqual(['--effort', 'xhigh']);
  });
});
