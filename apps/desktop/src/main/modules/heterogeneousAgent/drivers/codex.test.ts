import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PrepareProviderBindingContext } from '../types';
import { codexDriver, sanitizeCodexProviderBindingArgs } from './codex';

const bindingContext = (): PrepareProviderBindingContext => ({
  args: ['--model', 'stale-model', '-c', 'model_provider="other"', '--json'],
  env: { CODEX_HOME: '/user/codex', KEEP_ME: 'yes', OPENAI_API_KEY: 'stale-key' },
  profileDir: '/managed/codex',
  reference: {
    apiConfig: { model: 'gpt-test', providerId: 'responses-provider' },
    kind: 'provider',
  },
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
  it('writes a server-default Responses profile without the operation token', async () => {
    const plan = await codexDriver.prepareServerDefaultBinding!({
      args: [],
      endpoint: 'https://app.example.com',
      env: { LOBEHUB_HETERO_TOKEN: 'stale' },
      model: 'gpt-5.4',
      profileDir: '/tmp/profile',
    });
    const config = plan.profileFiles?.[0]?.content ?? '';

    expect(plan.args).toEqual(['--model', 'lobehub/gpt-5.4']);
    expect(config).toContain('model = "lobehub/gpt-5.4"');
    expect(config).toContain('base_url = "https://app.example.com/api/v1/openai/v1"');
    expect(config).toContain('env_key = "LOBEHUB_HETERO_TOKEN"');
    expect(config).not.toContain('model_catalog_json');
    expect(plan.profileFiles).toHaveLength(1);
    expect(config).not.toContain('stale');
    expect(plan.operationTokenEnvKey).toBe('LOBEHUB_HETERO_TOKEN');
    expect(plan.env.LOBEHUB_HETERO_TOKEN).toBeUndefined();
  });

  it.each([
    ['deepseek-v4-flash', 'high', ['low', 'high', 'max'], 'tokens'],
    ['deepseek-v4-pro', 'high', ['low', 'high', 'max'], 'tokens'],
    ['glm-5.2', 'max', ['high', 'max'], 'bytes'],
  ] as const)(
    'writes a current Codex model catalog for %s',
    async (selectedModel, defaultReasoningLevel, reasoningLevels, truncationMode) => {
      const profileDir = 'C:\\managed\\codex';
      const plan = await codexDriver.prepareServerDefaultBinding!({
        args: [],
        endpoint: 'https://app.example.com',
        env: {},
        model: selectedModel,
        profileDir,
      });
      const config = plan.profileFiles?.find(({ path }) => path === 'config.toml')?.content ?? '';
      const catalogContent = plan.profileFiles?.find(({ path }) => path === 'models.json')?.content;
      const catalog = JSON.parse(catalogContent ?? '{}');
      const model = catalog.models?.[0];

      expect(plan.args).toEqual(['--model', `lobehub/${selectedModel}`]);
      expect(config).toContain(
        `model_catalog_json = ${JSON.stringify(path.join(profileDir, 'models.json'))}`,
      );
      expect(catalog.models).toHaveLength(1);
      expect(model).toMatchObject({
        apply_patch_tool_type: null,
        context_window: 1_048_576,
        default_reasoning_level: defaultReasoningLevel,
        max_context_window: 1_048_576,
        shell_type: 'unified_exec',
        slug: `lobehub/${selectedModel}`,
        supports_parallel_tool_calls: true,
        supports_reasoning_summary_parameter: false,
        truncation_policy: { limit: 10_000, mode: truncationMode },
      });
      // The whole key set, not a sample. codex-cli rejects the catalog outright
      // on a field it requires and we do not write — it failed to parse for
      // `supports_parallel_tool_calls` while the `toMatchObject` above passed,
      // because a partial match cannot see what is missing. Any key added or
      // dropped here should be a decision, so it fails this list first.
      expect(Object.keys(model).sort()).toEqual([
        'apply_patch_tool_type',
        'availability_nux',
        'base_instructions',
        'context_window',
        'default_reasoning_level',
        'default_reasoning_summary',
        'default_verbosity',
        'description',
        'display_name',
        'effective_context_window_percent',
        'experimental_supported_tools',
        'input_modalities',
        'max_context_window',
        'priority',
        'shell_type',
        'slug',
        'support_verbosity',
        'supported_in_api',
        'supported_reasoning_levels',
        'supports_parallel_tool_calls',
        'supports_reasoning_summary_parameter',
        'truncation_policy',
        'upgrade',
        'visibility',
      ]);
      expect(
        model.supported_reasoning_levels.map(({ effort }: { effort: string }) => effort),
      ).toEqual(reasoningLevels);
    },
  );

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
