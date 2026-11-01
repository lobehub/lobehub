// @vitest-environment node
import { DEFAULT_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveExpertiseModelConfig } from './modelConfig';

const getUserSettings = vi.fn();

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = getUserSettings;
  },
}));

describe('resolveExpertiseModelConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to the main service model instead of the target agent model', async () => {
    getUserSettings.mockResolvedValue(undefined);

    await expect(resolveExpertiseModelConfig({} as never, 'user_1')).resolves.toEqual({
      model: DEFAULT_SYSTEM_AGENT_ITEM.model,
      provider: DEFAULT_SYSTEM_AGENT_ITEM.provider,
    });
  });

  it('uses the expertise model selected in Service Model settings', async () => {
    getUserSettings.mockResolvedValue({
      systemAgent: {
        expertise: { model: 'claude-sonnet-4-5', provider: 'anthropic' },
      },
    });

    await expect(resolveExpertiseModelConfig({} as never, 'user_1')).resolves.toEqual({
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
    });
  });
});
