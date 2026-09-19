import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mapFeatureFlagsEnvToState } from '@/config/featureFlags';
import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';

import { assertQuickNoteEnabled } from './featureGate';

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

/** @example Quick Note access follows the authenticated user's rollout decision. */
describe('Quick Note rollout gate', () => {
  /** @example Enabled users may reach note data. */
  it('allows an enabled user', async () => {
    vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig).mockResolvedValue(
      mapFeatureFlagsEnvToState({ quick_note: true }),
    );
    /** @example The resolver receives the authenticated identity. */
    await expect(assertQuickNoteEnabled('user-1')).resolves.toBeUndefined();
    /** @example Global anonymous flags are not substituted for the user decision. */
    expect(getServerFeatureFlagsStateFromRuntimeConfig).toHaveBeenCalledWith('user-1');
  });

  /** @example Both false and missing rollout values deny access. */
  it.each([false, undefined])('rejects when enabled is %s', async (enableQuickNote) => {
    vi.mocked(getServerFeatureFlagsStateFromRuntimeConfig).mockResolvedValue(
      mapFeatureFlagsEnvToState({ quick_note: enableQuickNote }),
    );
    /** @example Direct API access cannot bypass a disabled feature. */
    await expect(assertQuickNoteEnabled('user-2')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
