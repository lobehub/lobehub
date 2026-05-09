import { describe, expect, it } from 'vitest';

import { isResponsesApiSupportedSdkType, normalizeProviderSettings } from '../../providerSettings';

describe('isResponsesApiSupportedSdkType', () => {
  it('should return true for openai and router sdk types', () => {
    expect(isResponsesApiSupportedSdkType('openai')).toBe(true);
    expect(isResponsesApiSupportedSdkType('router')).toBe(true);
  });

  it('should return false for unsupported sdk types', () => {
    expect(isResponsesApiSupportedSdkType('anthropic')).toBe(false);
    expect(isResponsesApiSupportedSdkType(undefined)).toBe(false);
  });
});

describe('normalizeProviderSettings', () => {
  it('should keep supportResponsesApi when switching from router to openai', () => {
    const result = normalizeProviderSettings({
      nextSettings: { sdkType: 'openai' },
      previousSettings: { sdkType: 'router', supportResponsesApi: true },
    });

    expect(result).toEqual({
      sdkType: 'openai',
      supportResponsesApi: true,
    });
  });

  it('should auto-enable supportResponsesApi when sdkType is openai', () => {
    const result = normalizeProviderSettings({
      nextSettings: { sdkType: 'openai' },
      previousSettings: { sdkType: 'anthropic' },
    });

    expect(result).toEqual({
      sdkType: 'openai',
      supportResponsesApi: true,
    });
  });

  it('should auto-enable supportResponsesApi when sdkType is router', () => {
    const result = normalizeProviderSettings({
      nextSettings: { sdkType: 'router' },
      previousSettings: { sdkType: 'google' },
    });

    expect(result).toEqual({
      sdkType: 'router',
      supportResponsesApi: true,
    });
  });

  it('should remove supportResponsesApi when sdkType does not support responses api', () => {
    const result = normalizeProviderSettings({
      nextSettings: { sdkType: 'anthropic' },
      previousSettings: { sdkType: 'openai', supportResponsesApi: true },
    });

    expect(result).toEqual({
      sdkType: 'anthropic',
    });
    expect(result).not.toHaveProperty('supportResponsesApi');
  });

  it('should preserve unrelated settings fields while normalizing', () => {
    const result = normalizeProviderSettings({
      nextSettings: { sdkType: 'openai' },
      previousSettings: {
        modelEditable: false,
        showModelFetcher: true,
      },
    });

    expect(result).toEqual({
      modelEditable: false,
      sdkType: 'openai',
      showModelFetcher: true,
      supportResponsesApi: true,
    });
  });
});
