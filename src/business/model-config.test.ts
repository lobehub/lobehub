import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsProviderModelAvailable = vi.fn();
const mockLoadModelBankModels = vi.fn();

vi.mock('model-bank', () => ({
  isProviderModelAvailable: mockIsProviderModelAvailable,
  loadModels: mockLoadModelBankModels,
  ModelProvider: { LobeHub: 'lobehub' },
}));

const { isLobeHubModelAvailable, loadModels } =
  await import('@lobechat/business-model-bank/model-config');

describe('business model config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ACENSUS_AI_MODELS;
    delete process.env.ACENSUS_AI_DEFAULT_MODEL;
    mockLoadModelBankModels.mockImplementation(async ({ providerLoaders }) => {
      const lobehubModels = await providerLoaders.lobehub?.();

      return (lobehubModels ?? []).map((model) => ({ ...model, providerId: 'lobehub' }));
    });
  });

  it('should expose CometAPI-backed Acensus model capabilities by default', async () => {
    const getUserEmail = vi.fn();

    expect(isLobeHubModelAvailable('gpt-4.1-mini', 'chat', { getUserEmail })).toBe(true);

    const models = await loadModels();
    const model = models.find(
      (item) => item.id === 'gpt-4.1-mini' && item.providerId === 'lobehub',
    );

    expect(model?.abilities).toMatchObject({ functionCall: true, vision: true });
    expect(model?.type).toBe('chat');

    expect(mockLoadModelBankModels).toHaveBeenCalledTimes(1);
    expect(mockIsProviderModelAvailable).not.toHaveBeenCalled();
    expect(getUserEmail).not.toHaveBeenCalled();
  });

  it('should preserve image and video model types for env-only Acensus models', async () => {
    process.env.ACENSUS_AI_MODELS = 'flux-pro,wan-video-plus';

    const models = await loadModels();

    expect(models.find((item) => item.id === 'flux-pro')?.type).toBe('image');
    expect(models.find((item) => item.id === 'wan-video-plus')?.type).toBe('video');
  });
});
