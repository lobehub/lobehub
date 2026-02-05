import { act } from '@testing-library/react';
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { getProviderAuthPayload } from '../_auth';

// Mock data for different providers
const mockZhiPuAPIKey = 'zhipu-api-key';
const mockMoonshotAPIKey = 'moonshot-api-key';
const mockGoogleAPIKey = 'google-api-key';
const mockAnthropicAPIKey = 'anthropic-api-key';
const mockMistralAPIKey = 'mistral-api-key';
const mockOpenRouterAPIKey = 'openrouter-api-key';
const mockTogetherAIAPIKey = 'togetherai-api-key';

// mock the traditional zustand
vi.mock('zustand/traditional');

const setModelProviderConfig = (provider: string, config: any) => {
  useUserStore.setState({
    settings: { keyVaults: { [provider]: config } },
  });
};

describe('getProviderAuthPayload', () => {
  it('should return correct payload for ZhiPu provider', () => {
    const payload = getProviderAuthPayload(ModelProvider.ZhiPu, { apiKey: mockZhiPuAPIKey });
    expect(payload).toEqual({ apiKey: mockZhiPuAPIKey });
  });

  it('should return correct payload for Moonshot provider', () => {
    const payload = getProviderAuthPayload(ModelProvider.Moonshot, { apiKey: mockMoonshotAPIKey });
    expect(payload).toEqual({ apiKey: mockMoonshotAPIKey });
  });

  it('should return correct payload for Anthropic provider', () => {
    const payload = getProviderAuthPayload(ModelProvider.Anthropic, {
      apiKey: mockAnthropicAPIKey,
    });
    expect(payload).toEqual({ apiKey: mockAnthropicAPIKey });
  });

  it('should return correct payload for Mistral provider', () => {
    act(() => {
      setModelProviderConfig('mistral', { apiKey: mockMistralAPIKey });
    });

    const payload = getProviderAuthPayload(ModelProvider.Mistral, { apiKey: mockMistralAPIKey });
    expect(payload).toEqual({ apiKey: mockMistralAPIKey });
  });

  it('should return correct payload for OpenRouter provider', () => {
    const payload = getProviderAuthPayload(ModelProvider.OpenRouter, {
      apiKey: mockOpenRouterAPIKey,
    });
    expect(payload).toEqual({ apiKey: mockOpenRouterAPIKey });
  });

  it('should return correct payload for TogetherAI provider', () => {
    const payload = getProviderAuthPayload(ModelProvider.TogetherAI, {
      apiKey: mockTogetherAIAPIKey,
    });
    expect(payload).toEqual({ apiKey: mockTogetherAIAPIKey });
  });

  it('should return correct payload for Google provider', () => {
    const payload = getProviderAuthPayload(ModelProvider.Google, { apiKey: mockGoogleAPIKey });
    expect(payload).toEqual({ apiKey: mockGoogleAPIKey });
  });

  it('should return correct payload for Bedrock provider', () => {
    // 假设的 Bedrock 配置
    const mockBedrockConfig = {
      accessKeyId: 'bedrock-access-key-id',
      region: 'bedrock-region',
      secretAccessKey: 'bedrock-secret-access-key',
    };

    const payload = getProviderAuthPayload(ModelProvider.Bedrock, mockBedrockConfig);
    expect(payload).toEqual({
      apiKey: mockBedrockConfig.secretAccessKey + mockBedrockConfig.accessKeyId,
      awsAccessKeyId: mockBedrockConfig.accessKeyId,
      awsRegion: mockBedrockConfig.region,
      awsSecretAccessKey: mockBedrockConfig.secretAccessKey,
      accessKeyId: mockBedrockConfig.accessKeyId,
      accessKeySecret: mockBedrockConfig.secretAccessKey,
      awsSessionToken: undefined,
      region: mockBedrockConfig.region,
      sessionToken: undefined,
    });
  });

  it('should return correct payload for Azure provider', () => {
    // 假设的 Azure 配置
    const mockAzureConfig = {
      apiKey: 'azure-api-key',
      apiVersion: 'azure-api-version',
      endpoint: 'azure-endpoint',
    };

    const payload = getProviderAuthPayload(ModelProvider.Azure, mockAzureConfig);
    expect(payload).toEqual({
      apiKey: mockAzureConfig.apiKey,
      azureApiVersion: mockAzureConfig.apiVersion,
      apiVersion: mockAzureConfig.apiVersion,
      baseURL: mockAzureConfig.endpoint,
    });
  });

  it('should return correct payload for Ollama provider', () => {
    // 假设的 Ollama 配置
    const mockOllamaProxyUrl = 'ollama-proxy-url';

    const payload = getProviderAuthPayload(ModelProvider.Ollama, { baseURL: mockOllamaProxyUrl });
    expect(payload).toEqual({
      baseURL: mockOllamaProxyUrl,
    });
  });

  it('should return correct payload for OpenAI provider', () => {
    // 假设的 OpenAI 配置
    const mockOpenAIConfig = {
      apiKey: 'openai-api-key',
      baseURL: 'openai-endpoint',
      useAzure: true,
      azureApiVersion: 'openai-azure-api-version',
    };

    const payload = getProviderAuthPayload(ModelProvider.OpenAI, mockOpenAIConfig);
    expect(payload).toEqual({
      apiKey: mockOpenAIConfig.apiKey,
      baseURL: mockOpenAIConfig.baseURL,
    });
  });

  it('should return correct payload for Stepfun provider', () => {
    // 假设的 OpenAI 配置
    const mockOpenAIConfig = {
      apiKey: 'stepfun-api-key',
      baseURL: 'stepfun-baseURL',
    };

    const payload = getProviderAuthPayload(ModelProvider.Stepfun, mockOpenAIConfig);
    expect(payload).toEqual({
      apiKey: mockOpenAIConfig.apiKey,
      baseURL: mockOpenAIConfig.baseURL,
    });
  });

  it('should return correct payload for Cloudflare provider', () => {
    // 假设的 Cloudflare 配置
    const mockCloudflareConfig = {
      apiKey: 'cloudflare-api-key',
      baseURLOrAccountID: 'cloudflare-base-url-or-account-id',
    };
    act(() => {
      setModelProviderConfig('cloudflare', mockCloudflareConfig);
    });

    const payload = getProviderAuthPayload(ModelProvider.Cloudflare, mockCloudflareConfig);
    expect(payload).toEqual({
      apiKey: mockCloudflareConfig.apiKey,
      baseURLOrAccountID: mockCloudflareConfig.baseURLOrAccountID,
      cloudflareBaseURLOrAccountID: mockCloudflareConfig.baseURLOrAccountID,
    });
  });

  it('should return correct payload for VertexAI provider without splitting JSON credentials', () => {
    // Vertex AI uses JSON credentials that contain commas
    const mockVertexAIConfig = {
      apiKey: '{"type":"service_account","project_id":"test-project","private_key":"test-key"}',
      baseURL: 'https://us-central1-aiplatform.googleapis.com',
    };

    const payload = getProviderAuthPayload(ModelProvider.VertexAI, mockVertexAIConfig);
    expect(payload).toEqual({
      apiKey: mockVertexAIConfig.apiKey,
      baseURL: mockVertexAIConfig.baseURL,
    });
  });

  it('should return an empty object or throw an error for an unknown provider', () => {
    const payload = getProviderAuthPayload('UnknownProvider', {});
    expect(payload).toEqual({});
  });
});
