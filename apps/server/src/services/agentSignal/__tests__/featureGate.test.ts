// @vitest-environment node
import { isAgentSignalEnabledForUser, resetAgentSignalUserGateCache } from '../featureGate';

const mocks = vi.hoisted(() => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
  getUserPreference: vi.fn(),
  userModelConstructor: vi.fn(),
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.getServerFeatureFlagsStateFromRuntimeConfig,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: class {
    constructor(...args: unknown[]) {
      mocks.userModelConstructor(...args);
    }

    getUserPreference = mocks.getUserPreference;
  },
}));

describe('isAgentSignalEnabledForUser', () => {
  const db = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentSignalUserGateCache();
    // A stale rollout flag must no longer decide anything.
    mocks.getServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({
      enableAgentSelfIteration: true,
    });
  });

  /**
   * ROOT CAUSE: two switches gated self-evolution — the `agent_self_iteration` server flag for
   * the background pipeline and Labs → Self-evolving for expertise. The Labs switch is now the
   * single user-level gate.
   */
  it('reads the Labs Self-evolving switch instead of the feature flag', async () => {
    mocks.getUserPreference.mockResolvedValue({ lab: { enableSelfLearning: false } });

    await expect(isAgentSignalEnabledForUser(db, 'user-1')).resolves.toBe(false);
    expect(mocks.userModelConstructor).toHaveBeenCalledWith(db, 'user-1');
    expect(mocks.getServerFeatureFlagsStateFromRuntimeConfig).not.toHaveBeenCalled();
  });

  it('enables the user when the Labs switch is on', async () => {
    mocks.getUserPreference.mockResolvedValue({ lab: { enableSelfLearning: true } });

    await expect(isAgentSignalEnabledForUser(db, 'user-1')).resolves.toBe(true);
  });

  it('treats a missing preference or lab section as off', async () => {
    mocks.getUserPreference.mockResolvedValue(undefined);
    await expect(isAgentSignalEnabledForUser(db, 'user-1')).resolves.toBe(false);

    mocks.getUserPreference.mockResolvedValue({});
    await expect(isAgentSignalEnabledForUser(db, 'user-2')).resolves.toBe(false);
  });

  it('uses an already loaded preference without reading the database', async () => {
    await expect(
      isAgentSignalEnabledForUser(db, 'user-1', {
        preference: { lab: { enableSelfLearning: true } },
      }),
    ).resolves.toBe(true);
    await expect(
      isAgentSignalEnabledForUser(db, 'user-1', { preference: undefined }),
    ).resolves.toBe(false);
    expect(mocks.getUserPreference).not.toHaveBeenCalled();
  });

  it('reuses one read per user within the cache window', async () => {
    mocks.getUserPreference.mockResolvedValue({ lab: { enableSelfLearning: true } });

    await isAgentSignalEnabledForUser(db, 'user-1');
    await isAgentSignalEnabledForUser(db, 'user-1');

    expect(mocks.getUserPreference).toHaveBeenCalledOnce();
  });

  it('fails closed when the preference read errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getUserPreference.mockRejectedValue(new Error('db down'));

    await expect(isAgentSignalEnabledForUser(db, 'user-1')).resolves.toBe(false);
    consoleError.mockRestore();
  });
});
