import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

import { resolveAgentSignalModelConfig } from './modelConfig';

const getUserSettings = vi.fn();

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = getUserSettings;
  },
}));

const db = {} as LobeChatDatabase;

describe('resolveAgentSignalModelConfig', () => {
  beforeEach(() => {
    getUserSettings.mockReset();
  });

  it('runs self-iteration on the user Memory Analysis model', async () => {
    getUserSettings.mockResolvedValue({
      systemAgent: { memoryAnalysisAgentConfig: { model: 'gpt-6.1-sol', provider: 'chatgpt' } },
    });

    await expect(resolveAgentSignalModelConfig(db, 'user-1')).resolves.toEqual({
      model: 'gpt-6.1-sol',
      provider: 'chatgpt',
    });
  });

  it('falls back to the Memory Analysis default when the user has no settings', async () => {
    getUserSettings.mockResolvedValue(undefined);

    await expect(resolveAgentSignalModelConfig(db, 'user-1')).resolves.toEqual({
      model: DEFAULT_SYSTEM_AGENT_CONFIG.memoryAnalysisAgentConfig.model,
      provider: DEFAULT_SYSTEM_AGENT_CONFIG.memoryAnalysisAgentConfig.provider,
    });
  });
});
