import { describe, expect, it } from 'vitest';

import {
  AiProviderBaseURLSchema,
  CreateAiProviderSchema,
  UpdateAiProviderConfigSchema,
} from './aiProvider';

const invalidBaseURL = 'https://api.example.com /v1/chat/completions';

describe('AiProviderBaseURLSchema', () => {
  it('accepts HTTP endpoints', () => {
    expect(AiProviderBaseURLSchema.safeParse('https://api.example.com/v1').success).toBe(true);
    expect(AiProviderBaseURLSchema.safeParse('http://localhost:11434').success).toBe(true);
  });

  it('rejects malformed and non-HTTP endpoints', () => {
    expect(AiProviderBaseURLSchema.safeParse(invalidBaseURL).success).toBe(false);
    expect(AiProviderBaseURLSchema.safeParse('ftp://api.example.com/v1').success).toBe(false);
  });
});

describe('AI provider input schemas', () => {
  it('rejects an invalid baseURL when creating a provider', () => {
    const result = CreateAiProviderSchema.safeParse({
      id: 'custom-provider',
      keyVaults: { baseURL: invalidBaseURL },
      name: 'Custom Provider',
      source: 'custom',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['keyVaults', 'baseURL']);
  });

  it('rejects an invalid baseURL when updating provider config', () => {
    const result = UpdateAiProviderConfigSchema.safeParse({
      keyVaults: { baseURL: invalidBaseURL },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['keyVaults', 'baseURL']);
  });

  it('keeps empty endpoints and nested custom headers compatible', () => {
    expect(
      UpdateAiProviderConfigSchema.safeParse({
        keyVaults: { baseURL: '', customHeaders: { 'X-Custom': 'value' } },
      }).success,
    ).toBe(true);
  });
});
