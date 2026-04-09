import type { AiProviderDetailItem } from '@lobechat/types';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { LobeChatDatabase } from '../../../type';
import { AiInfraRepos } from '../index';

const userId = 'test-user-id';
const mockProviderConfigs = {
  openai: { enabled: true },
  anthropic: { enabled: false },
};

let serverDB: LobeChatDatabase;
let repo: AiInfraRepos;

beforeAll(async () => {
  serverDB = await getTestDB();
}, 30000);

beforeEach(() => {
  vi.clearAllMocks();
  repo = new AiInfraRepos(serverDB, userId, mockProviderConfigs);
});

describe('AiInfraRepos', () => {
  describe('getAiProviderDetail', () => {
    it('should merge provider config with user settings', async () => {
      const providerId = 'openai';
      const mockProviderDetail = {
        id: providerId,
        customSetting: 'test',
      } as unknown as AiProviderDetailItem;

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(mockProviderDetail);

      const result = await repo.getAiProviderDetail(providerId);

      expect(result).toMatchObject({
        id: providerId,
        customSetting: 'test',
        enabled: true, // from mockProviderConfigs
      });
    });

    it('should merge provider configs correctly', async () => {
      const mockProviderDetail = {
        enabled: true,
        id: 'openai',
        keyVaults: { apiKey: 'test-key' },
        name: 'Custom OpenAI',
        settings: {},
        source: 'builtin' as const,
      };

      vi.spyOn(repo.aiProviderModel, 'getAiProviderById').mockResolvedValue(mockProviderDetail);

      const result = await repo.getAiProviderDetail('openai');

      expect(result).toEqual({
        enabled: true,
        id: 'openai',
        keyVaults: { apiKey: 'test-key' },
        name: 'Custom OpenAI',
        settings: {},
        source: 'builtin',
      });
    });
  });
});
