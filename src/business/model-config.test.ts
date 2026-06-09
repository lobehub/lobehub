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

  it('should preserve default model-bank availability checks for LobeHub models', async () => {
    const loadedModels = [
      {
        enabled: true,
        id: 'image-model',
        providerId: 'lobehub',
        type: 'image',
      },
    ];
    mockLoadModelBankModels.mockResolvedValue(loadedModels);
    mockIsProviderModelAvailable.mockReturnValue(true);

    await expect(isLobeHubModelAvailable('image-model', 'image')).resolves.toBe(true);

    expect(mockIsProviderModelAvailable).toHaveBeenCalledWith(
      loadedModels,
      'lobehub',
      'image-model',
      'image',
    );
  });
});
