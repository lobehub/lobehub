// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isExpertiseInjectionEnabledForUser } from './featureGate';

const mocks = vi.hoisted(() => ({
  getUserPreference: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserPreference: mocks.getUserPreference,
  })),
}));

describe('isExpertiseInjectionEnabledForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to disabled when the Self Learning Lab is unset', async () => {
    mocks.getUserPreference.mockResolvedValue({});

    await expect(isExpertiseInjectionEnabledForUser({} as never, 'user-1')).resolves.toBe(false);
  });

  it('enables injection only when the Self Learning Lab is explicitly enabled', async () => {
    mocks.getUserPreference.mockResolvedValue({ lab: { enableSelfLearning: true } });

    await expect(isExpertiseInjectionEnabledForUser({} as never, 'user-1')).resolves.toBe(true);
  });

  it('fails closed when the preference cannot be read', async () => {
    const error = new Error('database unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getUserPreference.mockRejectedValue(error);

    await expect(isExpertiseInjectionEnabledForUser({} as never, 'user-1')).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to resolve expertise injection Lab preference:',
      error,
    );
  });
});
