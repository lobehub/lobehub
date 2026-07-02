// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isAgentSignalEnabledForUser,
  isLobeAiAgentSlug,
  resolveAgentSelfIterationCapability,
} from '../featureGate';

const mocks = vi.hoisted(() => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
  getUserPreference: vi.fn(),
  UserModel: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: mocks.UserModel,
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: mocks.getServerFeatureFlagsStateFromRuntimeConfig,
}));

describe('isAgentSignalEnabledForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.UserModel.mockImplementation(() => ({
      getUserPreference: mocks.getUserPreference,
    }));
    mocks.getServerFeatureFlagsStateFromRuntimeConfig.mockResolvedValue({
      enableAgentSelfIteration: true,
    });
    mocks.getUserPreference.mockResolvedValue({
      lab: { enableAgentSelfIteration: false },
    });
  });

  /**
   * @example
   * expect(result).toBe(true).
   */
  it('uses the feature flag as the user-level Agent Signal gate when lab preference is disabled', async () => {
    const result = await isAgentSignalEnabledForUser({} as never, 'user-1');

    expect(result).toBe(true);
    expect(mocks.getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledWith('user-1');
    expect(mocks.UserModel).not.toHaveBeenCalled();
    expect(mocks.getUserPreference).not.toHaveBeenCalled();
  });
});

describe('agentSignal feature gates', () => {
  it('recognizes only the inbox builtin slug as Lobe AI', () => {
    expect(isLobeAiAgentSlug('inbox')).toBe(true);
    expect(isLobeAiAgentSlug('task-agent')).toBe(false);
    expect(isLobeAiAgentSlug('page-agent')).toBe(false);
    expect(isLobeAiAgentSlug(undefined)).toBe(false);
    expect(isLobeAiAgentSlug(null)).toBe(false);
    expect(isLobeAiAgentSlug('')).toBe(false);
  });

  it('disables self-iteration when the feature flag is disabled', () => {
    expect(
      resolveAgentSelfIterationCapability({
        agentSelfIterationEnabled: true,
        isAgentSelfIterationFeatureEnabled: false,
        isLobeAiAgent: true,
      }),
    ).toBe(false);
  });

  it('enables Lobe AI self-iteration when the feature flag is enabled', () => {
    expect(
      resolveAgentSelfIterationCapability({
        isAgentSelfIterationFeatureEnabled: true,
        isLobeAiAgent: true,
      }),
    ).toBe(true);
  });

  it('keeps non-Lobe AI agents behind agentSelfIterationEnabled', () => {
    expect(
      resolveAgentSelfIterationCapability({
        agentSelfIterationEnabled: true,
        isAgentSelfIterationFeatureEnabled: true,
        isLobeAiAgent: false,
      }),
    ).toBe(true);

    expect(
      resolveAgentSelfIterationCapability({
        agentSelfIterationEnabled: false,
        isAgentSelfIterationFeatureEnabled: true,
        isLobeAiAgent: false,
      }),
    ).toBe(false);

    expect(
      resolveAgentSelfIterationCapability({
        isAgentSelfIterationFeatureEnabled: true,
        isLobeAiAgent: false,
      }),
    ).toBe(false);
  });
});
