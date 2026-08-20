import { describe, expect, it } from 'vitest';

import type { PrepareProviderBindingContext } from '../types';
import { codexDriver, sanitizeCodexProviderBindingArgs } from './codex';

const bindingContext = (): PrepareProviderBindingContext => ({
  args: ['--model', 'stale-model', '-c', 'model_provider="other"', '--json'],
  env: { CODEX_HOME: '/user/codex', KEEP_ME: 'yes', OPENAI_API_KEY: 'stale-key' },
  profileDir: '/managed/codex',
  reference: { apiConfig: { model: 'gpt-test', providerId: 'responses-provider' } },
  resolution: {
    agentType: 'codex',
    apiConfig: { model: 'gpt-test', providerId: 'responses-provider' },
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

describe('codexDriver provider binding', () => {
  it('writes a secret-free Responses provider config and injects the key through env', async () => {
    const plan = await codexDriver.prepareProviderBinding!(bindingContext());
    const config = plan.profileFiles?.[0]?.content ?? '';

    expect(plan.args).toEqual(['--json', '--model', 'gpt-test']);
    expect(plan.env).toEqual({
      CODEX_HOME: '/managed/codex',
      KEEP_ME: 'yes',
      LOBEHUB_CODEX_API_KEY: 'bound-key',
    });
    expect(config).toContain('model_provider = "lobehub"');
    expect(config).toContain('base_url = "https://responses.example.com/v1"');
    expect(config).toContain('env_key = "LOBEHUB_CODEX_API_KEY"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).not.toContain('bound-key');
  });

  it('removes only provider/model overrides and preserves unrelated config', () => {
    expect(
      sanitizeCodexProviderBindingArgs([
        '-m=old',
        '--config=model=old',
        '-c',
        'model_providers.other.base_url="https://other"',
        '-c',
        'sandbox_workspace_write.network_access=true',
      ]),
    ).toEqual(['-c', 'sandbox_workspace_write.network_access=true']);
  });
});
