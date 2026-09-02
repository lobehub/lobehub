import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindById = vi.fn();
vi.mock('@/database/models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

const mockGetServerDB = vi.fn();
vi.mock('@/database/server', () => ({
  getServerDB: (...args: unknown[]) => mockGetServerDB(...args),
}));

const { applyDevelopmentFeatureFlagDefaults, resolveEmailForEvaluation } = await import('./index');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('applyDevelopmentFeatureFlagDefaults', () => {
  it('enables Workspace in development when runtime config contains an allowlist', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FORCE_ENABLE_WORKSPACE_IN_DEV', 'true');

    expect(applyDevelopmentFeatureFlagDefaults({ workspace: ['production-user'] }).workspace).toBe(
      true,
    );
  });

  it('preserves an explicitly configured Workspace flag when the development force-enable is disabled', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FORCE_ENABLE_WORKSPACE_IN_DEV', 'false');

    expect(
      applyDevelopmentFeatureFlagDefaults(
        { workspace: ['production-user'] },
        {
          workspace: ['production-user'],
        },
      ).workspace,
    ).toEqual(['production-user']);
  });

  it('disables Workspace when the development force-enable is disabled and no runtime config sets it', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FORCE_ENABLE_WORKSPACE_IN_DEV', 'false');

    // The merged flags carry the isDev schema default (true); opting out must
    // neutralize it so the disabled path is testable locally.
    expect(applyDevelopmentFeatureFlagDefaults({ workspace: true }, {}).workspace).toBe(false);
    expect(applyDevelopmentFeatureFlagDefaults({ workspace: true }).workspace).toBe(false);
  });

  it('preserves the runtime Workspace flag outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(
      applyDevelopmentFeatureFlagDefaults({ workspace: ['production-user'] }).workspace,
    ).toEqual(['production-user']);
  });
});

describe('resolveEmailForEvaluation', () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockGetServerDB.mockReset();
    mockGetServerDB.mockResolvedValue({});
  });

  it('returns undefined without a userId, never touching UserModel', async () => {
    await expect(
      resolveEmailForEvaluation({ agent_share: ['someone@example.com'] }),
    ).resolves.toBeUndefined();
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('never touches UserModel when every array flag only carries user IDs', async () => {
    await expect(
      resolveEmailForEvaluation(
        { agent_share: ['user-1', 'user-2'], workspace: ['user-3'] },
        'user-1',
      ),
    ).resolves.toBeUndefined();
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('resolves the email when some flag array carries an email entry', async () => {
    mockFindById.mockResolvedValue({ email: 'user@example.com' });

    await expect(
      resolveEmailForEvaluation({ agent_share: ['someone@example.com', 'user-2'] }, 'user-1'),
    ).resolves.toBe('user@example.com');
    expect(mockFindById).toHaveBeenCalledWith({}, 'user-1');
  });

  it('swallows a lookup failure and returns undefined instead of throwing', async () => {
    mockFindById.mockRejectedValue(new Error('db unavailable'));

    await expect(
      resolveEmailForEvaluation({ agent_share: ['someone@example.com'] }, 'user-1'),
    ).resolves.toBeUndefined();
  });
});
