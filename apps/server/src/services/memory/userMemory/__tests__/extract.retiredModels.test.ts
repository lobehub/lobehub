import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isAvailable: vi.fn() }));

vi.mock('@lobechat/business-const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BRANDING_PROVIDER: 'lobehub',
}));
vi.mock('@lobechat/business-model-bank/model-config', () => ({
  isLobeHubModelAvailable: mocks.isAvailable,
}));
vi.mock('@lobechat/business-model-runtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveBusinessModelMapping: async (_provider: string, model: string) => ({
    resolvedModelId: model,
  }),
}));

const { withoutRetiredLobeHubMemoryModels } = await import('../extract/runtime');

describe('withoutRetiredLobeHubMemoryModels', () => {
  it('drops a memory model choice that names a retired LobeHub model', async () => {
    mocks.isAvailable.mockImplementation(async (model: string) => model !== 'retired-model');

    const result = await withoutRetiredLobeHubMemoryModels(
      {
        memoryAnalysisAgentConfig: { model: 'retired-model', provider: 'lobehub' },
        userMemoryEmbedding: { model: 'embed-model', provider: 'lobehub' },
      } as never,
      'user@example.com',
    );

    expect(result).toEqual({ userMemoryEmbedding: { model: 'embed-model', provider: 'lobehub' } });
    expect(mocks.isAvailable).toHaveBeenCalledWith('retired-model', 'chat', {
      userEmail: 'user@example.com',
    });
  });

  it('keeps choices on other providers without checking them', async () => {
    mocks.isAvailable.mockReset();
    const systemAgent = {
      memoryAnalysisAgentConfig: { model: 'gone-from-openrouter', provider: 'openrouter' },
    };

    expect(await withoutRetiredLobeHubMemoryModels(systemAgent as never)).toBe(systemAgent);
    expect(mocks.isAvailable).not.toHaveBeenCalled();
  });
});
