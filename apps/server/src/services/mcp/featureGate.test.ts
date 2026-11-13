// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpAppsEnabled, isMcpEventsEnabled } from './featureGate';

const getFlags = vi.hoisted(() => vi.fn());
vi.mock('@/server/featureFlags', () => ({ getServerFeatureFlagsStateFromRuntimeConfig: getFlags }));

describe('isMcpAppsEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows the mcp_apps flag for the user', async () => {
    getFlags.mockResolvedValue({ enableMcpApps: true });
    await expect(isMcpAppsEnabled('user-1')).resolves.toBe(true);
    expect(getFlags).toHaveBeenCalledWith('user-1');

    getFlags.mockResolvedValue({ enableMcpApps: false });
    await expect(isMcpAppsEnabled('user-1')).resolves.toBe(false);
  });

  it('treats an unreadable flag as off instead of failing the tool call', async () => {
    getFlags.mockRejectedValue(new Error('redis down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(isMcpAppsEnabled('user-1')).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('isMcpEventsEnabled', () => {
  it('defaults off and follows the runtime events flag', async () => {
    getFlags.mockResolvedValue({});
    expect(await isMcpEventsEnabled('user-1')).toBe(false);
    getFlags.mockResolvedValue({ enableMcpEvents: true });
    expect(await isMcpEventsEnabled('user-1')).toBe(true);
  });
  it('fails closed on a flag lookup error', async () => {
    getFlags.mockRejectedValue(new Error('unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await isMcpEventsEnabled('user-1')).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
});
