import type { AiProviderListItem } from '@lobechat/types';
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
  describe('getUserEnabledProviderList', () => {
    it('should return only enabled providers', async () => {
      const mockProviders = [
        { id: 'openai', enabled: true, name: 'OpenAI', sort: 1 },
        { id: 'anthropic', enabled: false, name: 'Anthropic', sort: 2 },
      ] as AiProviderListItem[];

      vi.spyOn(repo, 'getAiProviderList').mockResolvedValue(mockProviders);

      const result = await repo.getUserEnabledProviderList();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'openai',
        name: 'OpenAI',
      });
    });

    it('should return only enabled provider', async () => {
      const mockProviders = [
        {
          enabled: true,
          id: 'openai',
          logo: 'logo1',
          name: 'OpenAI',
          sort: 1,
          source: 'builtin' as const,
        },
        {
          enabled: false,
          id: 'anthropic',
          logo: 'logo2',
          name: 'Anthropic',
          sort: 2,
          source: 'builtin' as const,
        },
      ];

      vi.spyOn(repo.aiProviderModel, 'getAiProviderList').mockResolvedValue(mockProviders);

      const result = await repo.getUserEnabledProviderList();

      expect(result).toEqual([
        {
          id: 'openai',
          logo: 'logo1',
          name: 'OpenAI',
          source: 'builtin',
        },
      ]);
    });
  });
});
