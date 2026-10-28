// Fixture: a retained outcome asserted alongside one not-called check of the old flag.
import { beforeEach, expect, it, vi } from 'vitest';

import { isSignalEnabledForUser } from './featureGate';

const mocks = vi.hoisted(() => ({
  getFeatureFlags: vi.fn(),
  getUserPreference: vi.fn(),
}));

vi.mock('./featureFlags', () => ({ getFeatureFlags: mocks.getFeatureFlags }));
vi.mock('./userModel', () => ({
  UserModel: class {
    getUserPreference = mocks.getUserPreference;
  },
}));

beforeEach(() => {
  // A stale rollout flag must no longer decide anything.
  mocks.getFeatureFlags.mockResolvedValue({ enableSelfIteration: true });
});

// The server rollout flag was removed; the Labs switch is now the single gate.
it('reads the Labs switch instead of the removed rollout flag', async () => {
  mocks.getUserPreference.mockResolvedValue({ lab: { enableSelfLearning: false } });

  await expect(isSignalEnabledForUser('user-1')).resolves.toBe(false);
  expect(mocks.getUserPreference).toHaveBeenCalledOnce();
  expect(mocks.getFeatureFlags).not.toHaveBeenCalled();
});
