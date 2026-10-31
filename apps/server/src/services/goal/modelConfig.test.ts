// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { resolveGoalModelConfig } from './modelConfig';

const getUserSettings = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    getUserSettings = getUserSettings;
  },
}));

describe('resolveGoalModelConfig', () => {
  it("uses the goal's planning model without reading the system setting", async () => {
    await expect(
      resolveGoalModelConfig({} as never, 'user-1', {
        model: 'gemini-3.8-flash',
        provider: 'google',
      }),
    ).resolves.toEqual({ model: 'gemini-3.8-flash', provider: 'google' });
    expect(getUserSettings).not.toHaveBeenCalled();
  });

  it('falls back to the system goal model without a complete goal pick', async () => {
    getUserSettings.mockResolvedValue({
      systemAgent: { goal: { model: 'system-goal', provider: 'system-provider' } },
    });

    const resolved = await resolveGoalModelConfig({} as never, 'user-1', { model: 'gemini-only' });

    expect(getUserSettings).toHaveBeenCalled();
    expect(resolved).toMatchObject({ model: 'system-goal', provider: 'system-provider' });
  });
});
