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

  it('routes Claude, Codex, and Kimi Code only to their supported protocols', () => {
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

    const kimiAnthropic = resolveHeterogeneousProviderBinding({
      agentType: 'kimi-code',
      apiConfig: { model: 'claude-test', providerId: 'anthropic' },
      providerEnabled: true,
      runtimeConfig: runtime('anthropic'),
    });
    expect(kimiAnthropic.resolution?.protocol).toBe('anthropic-messages');

    const kimiOpenAI = resolveHeterogeneousProviderBinding({
      agentType: 'kimi-code',
      apiConfig: { model: 'gpt-test', providerId: 'openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai'),
    });
    expect(kimiOpenAI.resolution?.protocol).toBe('openai-chat-completions');

    const kimiCustomWithoutEndpoint = resolveHeterogeneousProviderBinding({
      agentType: 'kimi-code',
      apiConfig: { model: 'gpt-test', providerId: 'custom-openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai'),
    });
    expect(kimiCustomWithoutEndpoint.error?.code).toBe('endpointMissing');

    const kimiGoogle = resolveHeterogeneousProviderBinding({
      agentType: 'kimi-code',
      apiConfig: { model: 'gemini-test', providerId: 'google' },
      providerEnabled: true,
      runtimeConfig: runtime('google'),
    });
    expect(kimiGoogle.error?.code).toBe('protocolMismatch');
  });

  it('routes TRAE only to Responses providers', () => {
    const chatOnly = resolveHeterogeneousProviderBinding({
      agentType: 'trae',
      apiConfig: { model: 'model-test', providerId: 'custom-openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai', {
        keyVaults: { apiKey: 'test-key', baseURL: 'https://example.com/v1' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      }),
    });
    expect(chatOnly.error?.code).toBe('protocolMismatch');

    const responses = resolveHeterogeneousProviderBinding({
      agentType: 'trae',
      apiConfig: { model: 'model-test', providerId: 'custom-openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai', {
        config: { enableResponseApi: true },
        keyVaults: { apiKey: 'test-key', baseURL: 'https://example.com/v1/' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      }),
    });
    expect(responses.resolution).toMatchObject({
      endpoint: 'https://example.com/v1',
      protocol: 'openai-responses',
    });
  });

  it.each([
    {
      endpoint: 'https://chat.example.com/v1',
      expectedEndpoint: 'https://chat.example.com/v1',
      expectedProtocol: 'openai-chat-completions',
      providerId: 'custom-chat',
      sdkType: 'openai',
    },
    {
      endpoint: 'https://responses.example.com/v1/',
      expectedEndpoint: 'https://responses.example.com/v1',
      expectedProtocol: 'openai-responses',
      providerId: 'custom-responses',
      responses: true,
      sdkType: 'openai',
    },
    {
      endpoint: 'https://messages.example.com',
      expectedEndpoint: 'https://messages.example.com',
      expectedProtocol: 'anthropic-messages',
      providerId: 'custom-anthropic',
      sdkType: 'anthropic',
    },
    {
      endpoint: 'https://google.example.com/gemini/',
      expectedEndpoint: 'https://google.example.com/gemini/v1beta',
      expectedProtocol: 'google-generative-ai',
      providerId: 'custom-google',
      sdkType: 'google',
    },
  ] as const)(
    'binds Pi to $expectedProtocol',
    ({ endpoint, expectedEndpoint, expectedProtocol, providerId, responses, sdkType }) => {
      const result = resolveHeterogeneousProviderBinding({
        agentType: 'pi',
        apiConfig: { model: 'model-test', providerId },
        providerEnabled: true,
        runtimeConfig: runtime(sdkType, {
          config: responses ? { enableResponseApi: true } : {},
          keyVaults: { apiKey: 'test-key', baseURL: endpoint },
          settings: {
            sdkType,
            ...(responses ? { supportResponsesApi: true } : {}),
          },
        }),
      });

      expect(result.resolution).toMatchObject({
        endpoint: expectedEndpoint,
        protocol: expectedProtocol,
      });
    },
  );

  it.each([
    ['openai', 'openai', 'openai-responses', 'https://api.openai.com/v1'],
    ['anthropic', 'anthropic', 'anthropic-messages', 'https://api.anthropic.com'],
    [
      'google',
      'google',
      'google-generative-ai',
      'https://generativelanguage.googleapis.com/v1beta',
    ],
  ] as const)(
    'uses the canonical %s endpoint when no provider base URL is configured',
    (providerId, sdkType, protocol, endpoint) => {
      const result = resolveHeterogeneousProviderBinding({
        agentType: 'pi',
        apiConfig: { model: 'model-test', providerId },
        providerEnabled: true,
        runtimeConfig: runtime(sdkType),
      });

      expect(result.resolution).toMatchObject({ endpoint, protocol });
    },
  );

  it('requires a concrete endpoint for non-canonical Pi providers', () => {
    const result = resolveHeterogeneousProviderBinding({
      agentType: 'pi',
      apiConfig: { model: 'model-test', providerId: 'custom-openai' },
      providerEnabled: true,
      runtimeConfig: runtime('openai'),
    });

    expect(result.error).toEqual({ code: 'endpointMissing', providerId: 'custom-openai' });
  });

  it('carries server-resolved model capabilities into the binding resolution', () => {
    const modelMetadata = {
      abilities: { reasoning: true, vision: true },
      contextWindowTokens: 200_000,
      displayName: 'Bound model',
      id: 'model-test',
      maxOutput: 32_000,
      providerId: 'custom-openai',
      type: 'chat',
    };
    const result = resolveHeterogeneousProviderBinding({
      agentType: 'pi',
      apiConfig: { model: 'model-test', providerId: 'custom-openai' },
      enabledModels: [modelMetadata],
      providerEnabled: true,
      runtimeConfig: runtime('openai', {
        keyVaults: { apiKey: 'test-key', baseURL: 'https://example.com/v1' },
      }),
    });

    expect(result.resolution?.modelMetadata).toEqual(modelMetadata);
  });

  it.each([
    [
      'anthropic-messages',
      'anthropic-custom',
      runtime('anthropic', {
        keyVaults: { apiKey: 'test-key', baseURL: 'https://anthropic.example.com' },
      }),
    ],
    [
      'openai-chat-completions',
      'chat-provider',
      runtime('openai', {
        keyVaults: { apiKey: 'test-key', baseURL: 'https://chat.example.com/v1' },
      }),
    ],
    [
      'openai-responses',
      'responses-provider',
      runtime('openai', {
        config: { enableResponseApi: true },
        keyVaults: { apiKey: 'test-key', baseURL: 'https://responses.example.com/v1' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      }),
    ],
  ] as const)('allows Grok Build on %s', (protocol, providerId, runtimeConfig) => {
    const result = resolveHeterogeneousProviderBinding({
      agentType: 'grok-build',
      apiConfig: { model: 'bound-model', providerId },
      providerEnabled: true,
      runtimeConfig,
    });

    expect(result.resolution?.protocol).toBe(protocol);
  });

  it('uses official endpoints for Grok Build and rejects Google or missing custom endpoints', () => {
    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'grok-build',
        apiConfig: { model: 'gpt-test', providerId: 'openai' },
        providerEnabled: true,
        runtimeConfig: runtime('openai'),
      }).resolution,
    ).toMatchObject({ endpoint: 'https://api.openai.com/v1', protocol: 'openai-responses' });
    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'grok-build',
        apiConfig: { model: 'claude-test', providerId: 'anthropic' },
        providerEnabled: true,
        runtimeConfig: runtime('anthropic'),
      }).resolution,
    ).toMatchObject({ endpoint: 'https://api.anthropic.com', protocol: 'anthropic-messages' });
    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'grok-build',
        apiConfig: { model: 'gemini-test', providerId: 'google' },
        providerEnabled: true,
        runtimeConfig: runtime('google'),
      }).error?.code,
    ).toBe('protocolMismatch');
    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'grok-build',
        apiConfig: { model: 'chat-test', providerId: 'custom-openai' },
        providerEnabled: true,
        runtimeConfig: runtime('openai'),
      }).error?.code,
    ).toBe('endpointMissing');
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

  it('rejects unsupported protocols and agents without an implemented driver capability', () => {
    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'pi',
        apiConfig: { model: 'model', providerId: 'bedrock' },
        providerEnabled: true,
        runtimeConfig: runtime('bedrock'),
      }).error?.code,
    ).toBe('protocolMismatch');

    expect(
      resolveHeterogeneousProviderBinding({
        agentType: 'amp',
        apiConfig: { model: 'model', providerId: 'anthropic' },
        providerEnabled: true,
        runtimeConfig: runtime('anthropic'),
      }).error?.code,
    ).toBe('agentUnsupported');
  });
});
