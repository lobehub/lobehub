import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindById = vi.fn();
vi.mock('@/database/models/user', () => ({
  UserModel: { findById: (...args: unknown[]) => mockFindById(...args) },
}));

const mockGetServerDB = vi.fn();
vi.mock('@/database/server', () => ({
  getServerDB: (...args: unknown[]) => mockGetServerDB(...args),
}));

const {
  applyDevelopmentFeatureFlagDefaults,
  clearFeatureFlagEmailCache,
  resolveEmailForEvaluation,
} = await import('./index');

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
    clearFeatureFlagEmailCache();
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

  it('ignores email entries in flags that are never evaluated against an email', async () => {
    // `workspace` is evaluated by user ID only, so an '@' there must not cost a
    // users-table read on every single flag evaluation.
    await expect(
      resolveEmailForEvaluation({ workspace: ['someone@example.com'] }, 'user-1'),
    ).resolves.toBeUndefined();
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it('reuses the cached email for repeated evaluations of the same user', async () => {
    mockFindById.mockResolvedValue({ email: 'user@example.com' });
    const flags = { agent_share: ['someone@example.com'] };

    await expect(resolveEmailForEvaluation(flags, 'user-1')).resolves.toBe('user@example.com');
    await expect(resolveEmailForEvaluation(flags, 'user-1')).resolves.toBe('user@example.com');

    expect(mockFindById).toHaveBeenCalledTimes(1);
  });

  it('caches per user rather than globally', async () => {
    mockFindById.mockResolvedValueOnce({ email: 'one@example.com' });
    mockFindById.mockResolvedValueOnce({ email: 'two@example.com' });
    const flags = { agent_share: ['someone@example.com'] };

    await expect(resolveEmailForEvaluation(flags, 'user-1')).resolves.toBe('one@example.com');
    await expect(resolveEmailForEvaluation(flags, 'user-2')).resolves.toBe('two@example.com');
    await expect(resolveEmailForEvaluation(flags, 'user-1')).resolves.toBe('one@example.com');

    expect(mockFindById).toHaveBeenCalledTimes(2);
  });

  it('expires cached emails once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    try {
      mockFindById.mockResolvedValue({ email: 'user@example.com' });
      const flags = { agent_share: ['someone@example.com'] };

      await resolveEmailForEvaluation(flags, 'user-1');
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await resolveEmailForEvaluation(flags, 'user-1');

      expect(mockFindById).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows a lookup failure and returns undefined instead of throwing', async () => {
    mockFindById.mockRejectedValue(new Error('db unavailable'));

    await expect(
      resolveEmailForEvaluation({ agent_share: ['someone@example.com'] }, 'user-1'),
    ).resolves.toBeUndefined();
  });

  it('does not cache a failed lookup, so a transient DB error is retried', async () => {
    const flags = { agent_share: ['someone@example.com'] };
    mockFindById.mockRejectedValueOnce(new Error('db unavailable'));
    mockFindById.mockResolvedValueOnce({ email: 'user@example.com' });

    await expect(resolveEmailForEvaluation(flags, 'user-1')).resolves.toBeUndefined();
    await expect(resolveEmailForEvaluation(flags, 'user-1')).resolves.toBe('user@example.com');
  });
});
