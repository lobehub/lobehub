import type { AiProviderRuntimeState } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserScopedAiProviderRuntimeState } from './aiProviderAccess';

const mockGetHiddenBuiltinModelsForUser = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/aiProvider', () => ({
  getHiddenBuiltinModelsForUser: mockGetHiddenBuiltinModelsForUser,
}));

describe('getUserScopedAiProviderRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters hidden models and model-type providers for server consumers', async () => {
    const lobehubProvider = { id: 'lobehub', source: 'builtin' as const };
    const openaiProvider = { id: 'openai', source: 'builtin' as const };
    const hiddenChatModel = {
      abilities: {},
      id: 'hidden-chat',
      providerId: 'lobehub',
      type: 'chat' as const,
    };
    const visibleImageModel = {
      abilities: {},
      id: 'visible-image',
      providerId: 'openai',
      type: 'image' as const,
    };
    const runtimeState: AiProviderRuntimeState = {
      enabledAiModels: [hiddenChatModel, visibleImageModel],
      enabledAiProviders: [lobehubProvider, openaiProvider],
      enabledChatAiProviders: [lobehubProvider],
      enabledImageAiProviders: [openaiProvider],
      enabledVideoAiProviders: [],
      runtimeConfig: {},
    };
    mockGetHiddenBuiltinModelsForUser.mockResolvedValue([
      { id: 'hidden-chat', providerId: 'lobehub' },
    ]);

    const result = await getUserScopedAiProviderRuntimeState('user-1', async () => runtimeState);

    expect(result).toEqual({
      ...runtimeState,
      enabledAiModels: [visibleImageModel],
      enabledChatAiProviders: [],
      hiddenBuiltinModels: [{ id: 'hidden-chat', providerId: 'lobehub' }],
    });
  });
});
