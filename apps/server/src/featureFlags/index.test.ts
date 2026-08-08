import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDevelopmentFeatureFlagDefaults } from './index';

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
