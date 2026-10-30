// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpAppEnabled } from './featureGate';

const getFlags = vi.hoisted(() => vi.fn());
vi.mock('@/server/featureFlags', () => ({ getServerFeatureFlagsStateFromRuntimeConfig: getFlags }));

describe('isMcpAppEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows the mcp_app flag for the user', async () => {
    getFlags.mockResolvedValue({ enableMcpApp: true });
    await expect(isMcpAppEnabled('user-1')).resolves.toBe(true);
    expect(getFlags).toHaveBeenCalledWith('user-1');

    getFlags.mockResolvedValue({ enableMcpApp: false });
    await expect(isMcpAppEnabled('user-1')).resolves.toBe(false);
  });

  it('treats an unreadable flag as off instead of failing the tool call', async () => {
    getFlags.mockRejectedValue(new Error('redis down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(isMcpAppEnabled('user-1')).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
