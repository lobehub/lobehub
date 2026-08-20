import type { AiProviderRuntimeConfig } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  getProviderInferenceProtocols,
  resolveHeterogeneousProviderBinding,
} from './resolveBinding';

const runtime = (
  sdkType: AiProviderRuntimeConfig['settings']['sdkType'],
  overrides: Partial<AiProviderRuntimeConfig> = {},
): AiProviderRuntimeConfig => ({
  config: {},
  keyVaults: { apiKey: 'test-key' },
  settings: { sdkType },
  ...overrides,
});

describe('heterogeneous provider binding protocol resolver', () => {
  it('maps Anthropic and Google providers to their canonical protocols', () => {
    expect(getProviderInferenceProtocols('anthropic', runtime('anthropic'))).toEqual([
      'anthropic-messages',
    ]);
    expect(getProviderInferenceProtocols('google', runtime('google'))).toEqual([
      'google-generative-ai',
    ]);
  });

  it('keeps a custom OpenAI-compatible provider chat-only by default', () => {
    expect(
      getProviderInferenceProtocols(
        'custom-openai',
        runtime('openai', { settings: { sdkType: 'openai', supportResponsesApi: true } }),
      ),
    ).toEqual(['openai-chat-completions']);
  });

  it('enables Responses only when a capable provider actually opts in', () => {
    expect(
      getProviderInferenceProtocols(
        'custom-openai',
        runtime('openai', {
          config: { enableResponseApi: true },
          settings: { sdkType: 'openai', supportResponsesApi: true },
        }),
      ),
    ).toEqual(['openai-responses', 'openai-chat-completions']);
  });

  it('allows Claude only on Messages and Codex only on Responses', () => {
    const claude = resolveHeterogeneousProviderBinding({
      agentType: 'claude-code',
      apiConfig: { model: 'claude-test', providerId: 'anthropic' },
      providerEnabled: true,
      runtimeConfig: runtime('anthropic'),
    });
    expect(claude.resolution?.protocol).toBe('anthropic-messages');

    const codexChatOnly = resolveHeterogeneousProviderBinding({
      agentType: 'codex',
      apiConfig: { model: 'gpt-test', providerId: 'custom-openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai', {
        keyVaults: { apiKey: 'test-key', baseURL: 'https://example.com/v1' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      }),
    });
    expect(codexChatOnly.error?.code).toBe('protocolMismatch');

    const codexResponses = resolveHeterogeneousProviderBinding({
      agentType: 'codex',
      apiConfig: { model: 'gpt-test', providerId: 'custom-openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai', {
        config: { enableResponseApi: true },
        keyVaults: { apiKey: 'test-key', baseURL: 'https://example.com/v1/' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      }),
    });
    expect(codexResponses.resolution).toMatchObject({
      endpoint: 'https://example.com/v1',
      protocol: 'openai-responses',
    });
  });

  it('validates credentials only inside the trusted host boundary', () => {
    const input = {
      agentType: 'claude-code',
      apiConfig: { model: 'claude-test', providerId: 'anthropic' },
      providerEnabled: true,
      runtimeConfig: runtime('anthropic', { keyVaults: {} }),
    };
    expect(resolveHeterogeneousProviderBinding(input).error).toBeUndefined();
    expect(
      resolveHeterogeneousProviderBinding({ ...input, checkCredentials: true }).error?.code,
    ).toBe('credentialsMissing');
  });

  it('rejects API bindings for agents without an implemented driver capability', () => {
    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'pi',
        apiConfig: { model: 'model', providerId: 'anthropic' },
        providerEnabled: true,
        runtimeConfig: runtime('anthropic'),
      }).error?.code,
    ).toBe('agentUnsupported');
  });
});
