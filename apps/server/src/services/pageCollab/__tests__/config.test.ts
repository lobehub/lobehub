// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isPageCollabEnabledForUser } from '../config';

const { getFlags } = vi.hoisted(() => ({
  getFlags: vi.fn(),
}));

vi.mock('@/server/featureFlags', () => ({
  getServerFeatureFlagsStateFromRuntimeConfig: getFlags,
}));

vi.mock('../roomClient', () => ({
  createPageRoomClient: () => undefined,
}));

describe('isPageCollabEnabledForUser', () => {
  beforeEach(() => {
    getFlags.mockReset();
  });

  it('follows the page_collab flag evaluated for the user', async () => {
    getFlags.mockResolvedValue({ enablePageCollab: true });
    expect(await isPageCollabEnabledForUser('u1')).toBe(true);
    expect(getFlags).toHaveBeenCalledWith('u1');

    getFlags.mockResolvedValue({ enablePageCollab: false });
    expect(await isPageCollabEnabledForUser('u1')).toBe(false);

    getFlags.mockResolvedValue({ enablePageCollab: undefined });
    expect(await isPageCollabEnabledForUser('u1')).toBe(false);
  });

  it('counts a flag that cannot be read as off', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getFlags.mockRejectedValue(new Error('redis down'));

    expect(await isPageCollabEnabledForUser('u1')).toBe(false);
    error.mockRestore();
  });
});
