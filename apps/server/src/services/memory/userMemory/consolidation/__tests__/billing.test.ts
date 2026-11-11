import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryConsolidationService } from '../service';

const mocks = vi.hoisted(() => ({
  businessHooks: { name: 'business' },
  generateObject: vi.fn(),
  getUserScopedAiProviderRuntimeState: vi.fn(),
  initializeWithProvider: vi.fn(),
  platformHooks: { name: 'platform' },
}));

vi.mock('@lobechat/model-runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModelRuntime: { initializeWithProvider: mocks.initializeWithProvider },
}));

vi.mock('@/business/server/model-runtime', () => ({
  getBusinessModelRuntimeHooks: () => mocks.businessHooks,
}));

vi.mock('@/business/server/platform-model-runtime', () => ({
  getPlatformModelRuntimeHooks: () => mocks.platformHooks,
}));

vi.mock('@/server/services/aiProviderAccess', () => ({
  getUserScopedAiProviderRuntimeState: mocks.getUserScopedAiProviderRuntimeState,
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    agentConsolidation: { apiKey: 'sys-key', model: 'deepseek-flash', provider: 'lobehub' },
  }),
}));

vi.mock('@/database/models/userMemory/consolidation', () => ({
  UserMemoryConsolidationModel: vi.fn(function () {
    return { getLegacyContextsByIds: vi.fn(async () => []) };
  }),
}));

describe('MemoryConsolidationService billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateObject.mockResolvedValue({ items: [] });
    mocks.initializeWithProvider.mockReturnValue({ generateObject: mocks.generateObject });
  });

  it('runs a platform-paid run on system credentials with the platform hooks', async () => {
    const service = new MemoryConsolidationService({} as never, 'u1', 'wfr_1', {
      billing: 'platform',
    });

    await service.classify(['c1']);

    // The user's providers are never resolved, so their keys and credits stay untouched.
    expect(mocks.getUserScopedAiProviderRuntimeState).not.toHaveBeenCalled();
    expect(mocks.initializeWithProvider).toHaveBeenCalledWith(
      'lobehub',
      { userId: 'u1' },
      mocks.platformHooks,
    );
    expect(mocks.generateObject.mock.calls[0][1].metadata).toMatchObject({
      consolidationRunId: 'wfr_1',
      traceId: 'wfr_1',
    });
  });
});
