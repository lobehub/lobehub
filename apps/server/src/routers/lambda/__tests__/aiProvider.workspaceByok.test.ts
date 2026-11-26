// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiModelModel } from '@/database/models/aiModel';
import { AiProviderModel } from '@/database/models/aiProvider';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type AiProviderRuntimeState } from '@/types/aiProvider';

import { aiProviderRouter } from '../aiProvider';

const isWorkspaceByokAllowed = vi.hoisted(() => vi.fn());

vi.mock('@/business/server/workspaceByok', () => ({ isWorkspaceByokAllowed }));
vi.mock('@/business/server/aiProvider', () => ({
  getHiddenBuiltinModelsForUser: vi.fn(async () => []),
  getModelRedirects: vi.fn(async () => ({})),
}));
vi.mock('@/server/globalConfig');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/database/repositories/aiInfra');
vi.mock('@/database/models/aiModel');
vi.mock('@/database/models/aiProvider');
vi.mock('@/database/models/user');
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/server/modules/AgentRuntime/llmRelay/resolveLlmExecutionSite', () => ({
  resolveProviderRelay: vi.fn(),
}));
vi.mock('@lobechat/business-const', async () => ({
  ...(await vi.importActual<typeof BusinessConst>('@lobechat/business-const')),
  BRANDING_PROVIDER: 'lobehub',
  ENABLE_BUSINESS_FEATURES: true,
  isOfficialProvider: (id: string) => id === 'lobehub',
}));

const runtimeState: AiProviderRuntimeState = {
  enabledAiModels: [
    { abilities: {}, id: 'lobe-model', providerId: 'lobehub', type: 'chat' },
    { abilities: {}, id: 'gpt-own', providerId: 'openai', type: 'chat' },
  ] as any,
  enabledAiProviders: [{ id: 'lobehub' }, { id: 'openai' }] as any,
  enabledChatAiProviders: [{ id: 'lobehub' }, { id: 'openai' }] as any,
  enabledImageAiProviders: [],
  enabledVideoAiProviders: [],
  runtimeConfig: {
    lobehub: { keyVaults: {}, settings: {} },
    openai: { keyVaults: { apiKey: 'sk-own' }, settings: {} },
  } as any,
};

const callerIn = (workspaceId?: string) =>
  aiProviderRouter.createCaller({ userId: 'user-1', workspaceId } as any);

describe('aiProviderRouter in a workspace without own provider keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWorkspaceByokAllowed.mockResolvedValue(false);
    vi.mocked(getServerGlobalConfig).mockReturnValue({ aiProvider: {} } as any);
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue({ encrypt: vi.fn() } as any);
    vi.mocked(AiModelModel).prototype.getAllModelReasoningConfigs = vi.fn(async () => ({}));
    vi.mocked(AiProviderModel).prototype.create = vi.fn();
    vi.mocked(AiProviderModel).prototype.update = vi.fn();
    vi.mocked(AiProviderModel).prototype.updateConfig = vi.fn();
    vi.mocked(AiInfraRepos).prototype.getAiProviderRuntimeState = vi.fn(async () => runtimeState);
    vi.mocked(AiInfraRepos).prototype.getAiProviderDetail = vi.fn(async (id: string) => ({
      id,
      keyVaults: { apiKey: 'sk-own' },
    })) as any;
  });

  it('keeps only the platform provider in the runtime state, so no own key reaches the client', async () => {
    const state = await callerIn('ws-1').getAiProviderRuntimeState({});

    expect(isWorkspaceByokAllowed).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'ws-1' });
    expect(state.enabledAiProviders.map((p) => p.id)).toEqual(['lobehub']);
    expect(state.enabledChatAiProviders.map((p) => p.id)).toEqual(['lobehub']);
    expect(state.enabledAiModels.map((m) => m.id)).toEqual(['lobe-model']);
    expect(Object.keys(state.runtimeConfig)).toEqual(['lobehub']);
  });

  it('keeps every provider where the workspace may use its own keys, and in personal mode', async () => {
    isWorkspaceByokAllowed.mockResolvedValue(true);
    const listed = await callerIn('ws-1').getAiProviderRuntimeState({});
    expect(Object.keys(listed.runtimeConfig)).toEqual(['lobehub', 'openai']);

    isWorkspaceByokAllowed.mockClear();
    const personal = await callerIn().getAiProviderRuntimeState({});
    expect(Object.keys(personal.runtimeConfig)).toEqual(['lobehub', 'openai']);
    expect(isWorkspaceByokAllowed).not.toHaveBeenCalled();
  });

  it('never returns the keys of an own-key provider', async () => {
    const detail = await callerIn('ws-1').getAiProviderById({ id: 'openai' });
    expect(detail?.keyVaults).toBeUndefined();
  });

  it('refuses to create, configure or enable an own-key provider', async () => {
    const caller = callerIn('ws-1');

    await expect(
      caller.createAiProvider({ id: 'my-proxy', name: 'Proxy', source: 'custom' } as any),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.updateAiProviderConfig({ id: 'openai', value: { keyVaults: { apiKey: 'sk' } } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.updateAiProvider({ id: 'openai', value: { name: 'x' } as any }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.toggleProviderEnabled({ enabled: true, id: 'openai' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(AiProviderModel.prototype.create).not.toHaveBeenCalled();
    expect(AiProviderModel.prototype.update).not.toHaveBeenCalled();
    expect(AiProviderModel.prototype.updateConfig).not.toHaveBeenCalled();
  });

  it('still lets the workspace turn an own-key provider off', async () => {
    vi.mocked(AiProviderModel).prototype.toggleProviderEnabled = vi.fn();

    await callerIn('ws-1').toggleProviderEnabled({ enabled: false, id: 'openai' });

    expect(AiProviderModel.prototype.toggleProviderEnabled).toHaveBeenCalledWith('openai', false);
  });
});
