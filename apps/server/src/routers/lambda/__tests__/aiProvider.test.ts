// @vitest-environment node
import type * as BusinessConst from '@lobechat/business-const';
import { OFFICIAL_PROVIDER_DISABLE_ERROR } from '@lobechat/business-const';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiProviderModel } from '@/database/models/aiProvider';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { type AiProviderDetailItem, type AiProviderRuntimeState } from '@/types/aiProvider';

import { aiProviderRouter } from '../aiProvider';

vi.mock('@/server/globalConfig');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/database/repositories/aiInfra');
vi.mock('@/database/models/aiProvider');
vi.mock('@/database/models/user');
vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));
vi.mock('@lobechat/business-const', async () => {
  const actual = await vi.importActual<typeof BusinessConst>('@lobechat/business-const');

  return {
    ...actual,
    BRANDING_PROVIDER: 'lobehub',
    ENABLE_BUSINESS_FEATURES: true,
    isOfficialProvider: (id: string) => id === 'lobehub',
  };
});

describe('aiProviderRouter', () => {
  const mockUserId = 'test-user-id';
  const mockProviderId = 'test-provider-id';
  const mockEncrypt = vi.fn();
  const mockDecrypt = vi.fn();

  const mockGateKeeper = {
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
  };

  const mockProviderDetail: AiProviderDetailItem = {
    id: mockProviderId,
    name: 'Test Provider',
    enabled: true,
    description: 'Test Description',
    source: 'custom',
    settings: {},
  };

  const mockRuntimeState: AiProviderRuntimeState = {
    enabledAiModels: [],
    enabledAiProviders: [],
    enabledChatAiProviders: [],
    enabledImageAiProviders: [],
    enabledVideoAiProviders: [],
    runtimeConfig: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getServerGlobalConfig).mockReturnValue({
      aiProvider: {},
    } as any);

    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
  });

  const createMockContext = () => ({
    userId: mockUserId,
  });

  describe('checkProviderConnectivity', () => {
    it('should pass api trigger metadata to the runtime connectivity check', async () => {
      const mockChat = vi.fn().mockResolvedValue({ ok: true });
      const mockGetDetail = vi
        .fn()
        .mockResolvedValue({ ...mockProviderDetail, checkModel: 'gpt-4' });

      vi.mocked(AiInfraRepos).prototype.getAiProviderDetail = mockGetDetail;
      vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ chat: mockChat } as any);

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.checkProviderConnectivity({ id: mockProviderId });

      expect(result).toEqual({ model: 'gpt-4', ok: true });
      expect(mockChat).toHaveBeenCalledWith(
        {
          messages: [{ content: 'Hi', role: 'user' }],
          model: 'gpt-4',
          stream: false,
          temperature: 0,
        },
        {
          metadata: { trigger: RequestTrigger.Api },
        },
      );
    });
  });

  describe('createAiProvider', () => {
    it('should create a new AI provider', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ id: mockProviderId });
      vi.mocked(AiProviderModel).prototype.create = mockCreate;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.createAiProvider({
        id: mockProviderId,
        name: 'Test Provider',
        source: 'custom',
      });

      expect(result).toBe(mockProviderId);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockProviderId,
          name: 'Test Provider',
        }),
        mockGateKeeper.encrypt,
      );
    });
  });

  describe('getAiProviderById', () => {
    it('should get AI provider by id', async () => {
      const mockGetDetail = vi.fn().mockResolvedValue(mockProviderDetail);
      vi.mocked(AiInfraRepos).prototype.getAiProviderDetail = mockGetDetail;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.getAiProviderById({ id: mockProviderId });

      expect(result).toEqual(mockProviderDetail);
      expect(mockGetDetail).toHaveBeenCalledWith(
        mockProviderId,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
    });
  });

  describe('getAiProviderList', () => {
    it('should get AI provider list', async () => {
      const mockList = [mockProviderDetail];
      const mockGetList = vi.fn().mockResolvedValue(mockList);
      vi.mocked(AiInfraRepos).prototype.getAiProviderList = mockGetList;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.getAiProviderList();

      expect(result).toEqual(mockList);
      expect(mockGetList).toHaveBeenCalled();
    });
  });

  describe('getAiProviderRuntimeState', () => {
    it('should get AI provider runtime state', async () => {
      const mockGetState = vi.fn().mockResolvedValue(mockRuntimeState);
      vi.mocked(AiInfraRepos).prototype.getAiProviderRuntimeState = mockGetState;

      const caller = aiProviderRouter.createCaller(createMockContext());
      const result = await caller.getAiProviderRuntimeState({});

      expect(result).toEqual(mockRuntimeState);
      expect(mockGetState).toHaveBeenCalledWith(KeyVaultsGateKeeper.getUserKeyVaults);
    });
  });

  describe('removeAiProvider', () => {
    it('should remove AI provider', async () => {
      const mockDelete = vi.fn();
      vi.mocked(AiProviderModel).prototype.delete = mockDelete;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.removeAiProvider({ id: mockProviderId });

      expect(mockDelete).toHaveBeenCalledWith(mockProviderId);
    });
  });

  describe('toggleProviderEnabled', () => {
    it('should toggle provider enabled state', async () => {
      const mockToggle = vi.fn();
      vi.mocked(AiProviderModel).prototype.toggleProviderEnabled = mockToggle;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.toggleProviderEnabled({
        id: mockProviderId,
        enabled: true,
      });

      expect(mockToggle).toHaveBeenCalledWith(mockProviderId, true);
    });

    it('should reject disabling the official provider', async () => {
      const mockToggle = vi.fn();
      vi.mocked(AiProviderModel).prototype.toggleProviderEnabled = mockToggle;

      const caller = aiProviderRouter.createCaller(createMockContext());

      await expect(
        caller.toggleProviderEnabled({
          enabled: false,
          id: 'lobehub',
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: OFFICIAL_PROVIDER_DISABLE_ERROR,
      });

      expect(mockToggle).not.toHaveBeenCalled();
    });
  });

  describe('updateAiProvider', () => {
    it('should update AI provider', async () => {
      const mockUpdate = vi.fn();
      vi.mocked(AiProviderModel).prototype.update = mockUpdate;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.updateAiProvider({
        id: mockProviderId,
        value: { name: 'Updated Provider' },
      });

      expect(mockUpdate).toHaveBeenCalledWith(mockProviderId, {
        name: 'Updated Provider',
      });
    });
  });

  describe('updateAiProviderConfig', () => {
    it('should update AI provider config', async () => {
      const mockUpdateConfig = vi.fn();
      vi.mocked(AiProviderModel).prototype.updateConfig = mockUpdateConfig;

      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.updateAiProviderConfig({
        id: mockProviderId,
        value: { checkModel: 'gpt-4' },
      });

      expect(mockUpdateConfig).toHaveBeenCalledWith(
        mockProviderId,
        { checkModel: 'gpt-4' },
        mockGateKeeper.encrypt,
        KeyVaultsGateKeeper.getUserKeyVaults,
      );
    });
  });

  describe('updateAiProviderOrder', () => {
    it('should update AI provider order', async () => {
      const mockUpdateOrder = vi.fn();
      vi.mocked(AiProviderModel).prototype.updateOrder = mockUpdateOrder;

      const sortMap = [{ id: mockProviderId, sort: 1 }];
      const caller = aiProviderRouter.createCaller(createMockContext());
      await caller.updateAiProviderOrder({ sortMap });

      expect(mockUpdateOrder).toHaveBeenCalledWith(sortMap);
    });
  });
});
