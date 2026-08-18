// @vitest-environment node
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

  it('defaults to GPT-5.6 Luna instead of the target agent model', async () => {
    getUserSettings.mockResolvedValue(undefined);

    await expect(resolveExpertiseModelConfig({} as never, 'user_1')).resolves.toEqual({
      model: 'gpt-5.6-luna',
      provider: 'openai',
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
