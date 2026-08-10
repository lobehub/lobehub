import { BRANDING_NAME } from '@lobechat/business-const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('brandedModelId', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rewrites openrouter/ ids to branding slug when custom branding is on', async () => {
    vi.doMock('@/const/version', () => ({ isCustomBranding: true }));
    const { formatBrandedModelId, isBrandedOpenRouterModelId, getBrandingModelSlug } =
      await import('./brandedModelId');

    expect(getBrandingModelSlug()).toBe(BRANDING_NAME.trim().toLowerCase());
    expect(isBrandedOpenRouterModelId('openrouter/auto')).toBe(true);
    expect(isBrandedOpenRouterModelId('OpenRouter/auto')).toBe(true);
    expect(formatBrandedModelId('openrouter/auto')).toBe(`${getBrandingModelSlug()}/auto`);
    expect(formatBrandedModelId('deepseek/deepseek-chat')).toBe('deepseek/deepseek-chat');
  });

  it('leaves ids unchanged when not custom branding', async () => {
    vi.doMock('@/const/version', () => ({ isCustomBranding: false }));
    const { formatBrandedModelId, isBrandedOpenRouterModelId } = await import('./brandedModelId');

    expect(isBrandedOpenRouterModelId('openrouter/auto')).toBe(false);
    expect(formatBrandedModelId('openrouter/auto')).toBe('openrouter/auto');
  });

  it('rewrites openrouter provider label to branding name when custom branding is on', async () => {
    vi.doMock('@/const/version', () => ({ isCustomBranding: true }));
    const { formatBrandedProviderId, isBrandedOpenRouterProvider } =
      await import('./brandedModelId');

    expect(isBrandedOpenRouterProvider('openrouter')).toBe(true);
    expect(isBrandedOpenRouterProvider('OpenRouter')).toBe(true);
    expect(formatBrandedProviderId('openrouter')).toBe(BRANDING_NAME);
    expect(formatBrandedProviderId('openai')).toBe('openai');
  });

  it('leaves provider labels unchanged when not custom branding', async () => {
    vi.doMock('@/const/version', () => ({ isCustomBranding: false }));
    const { formatBrandedProviderId, isBrandedOpenRouterProvider } =
      await import('./brandedModelId');

    expect(isBrandedOpenRouterProvider('openrouter')).toBe(false);
    expect(formatBrandedProviderId('openrouter')).toBe('openrouter');
  });
});
