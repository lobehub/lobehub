// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { isWebhookEnabled } from './featureGate';

const getFlags = vi.hoisted(() => vi.fn());
vi.mock('@/server/featureFlags', () => ({ getServerFeatureFlagsStateFromRuntimeConfig: getFlags }));

describe('isWebhookEnabled', () => {
  it('defaults off and follows the runtime webhook flag', async () => {
    getFlags.mockResolvedValue({});
    expect(await isWebhookEnabled('user-1')).toBe(false);
    getFlags.mockResolvedValue({ enableWebhook: true });
    expect(await isWebhookEnabled('user-1')).toBe(true);
    expect(getFlags).toHaveBeenCalledWith('user-1');
  });
  it('fails closed on a flag lookup error', async () => {
    getFlags.mockRejectedValue(new Error('unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await isWebhookEnabled('user-1')).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
});
