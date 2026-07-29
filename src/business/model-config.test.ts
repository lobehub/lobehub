import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsProviderModelAvailable = vi.fn();
const mockLoadModelBankModels = vi.fn();

vi.mock('model-bank', () => ({
  isProviderModelAvailable: mockIsProviderModelAvailable,
  loadModels: mockLoadModelBankModels,
  ModelProvider: { LobeHub: 'lobehub' },
}));

const { isLobeHubModelAvailable } = await import('@lobechat/business-model-bank/model-config');

describe('business model config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should disable LobeHub model availability by default', () => {
    const getUserEmail = vi.fn();

    expect(isLobeHubModelAvailable('image-model', 'image', { getUserEmail })).toBe(false);

    expect(mockLoadModelBankModels).not.toHaveBeenCalled();
    expect(mockIsProviderModelAvailable).not.toHaveBeenCalled();
    expect(getUserEmail).not.toHaveBeenCalled();
  });
});
