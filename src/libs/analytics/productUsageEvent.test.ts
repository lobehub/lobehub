import type { AnalyticsManager } from '@lobehub/analytics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isProductUsageEventEnabled, trackProductUsageEvent } from './productUsageEvent';

const telemetryState = vi.hoisted(() => ({ enabled: true }));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({ telemetry: telemetryState.enabled }),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    telemetry: (state: { telemetry: boolean }) => state.telemetry,
  },
}));

describe('product usage event analytics', () => {
  beforeEach(() => {
    telemetryState.enabled = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks settings.general.telemetry', () => {
    expect(isProductUsageEventEnabled()).toBe(true);

    telemetryState.enabled = false;

    expect(isProductUsageEventEnabled()).toBe(false);
  });

  it('tracks when telemetry is enabled', async () => {
    const track = vi.fn().mockResolvedValue(undefined);
    const analytics = {
      getStatus: () => ({ initialized: true, providersCount: 1 }),
      track,
    } as unknown as AnalyticsManager;

    const tracked = await trackProductUsageEvent(
      { name: 'test_event', properties: { source: 'test' } },
      { analytics },
    );

    expect(tracked).toBe(true);
    expect(track).toHaveBeenCalledWith({ name: 'test_event', properties: { source: 'test' } });
  });

  it('does not track when telemetry is disabled', async () => {
    telemetryState.enabled = false;
    const track = vi.fn().mockResolvedValue(undefined);
    const analytics = { track } as unknown as AnalyticsManager;

    const tracked = await trackProductUsageEvent({ name: 'test_event' }, { analytics });

    expect(tracked).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it('does not track before analytics is initialized', async () => {
    const track = vi.fn().mockResolvedValue(undefined);
    const analytics = {
      getStatus: () => ({ initialized: false, providersCount: 1 }),
      track,
    } as unknown as AnalyticsManager;

    const tracked = await trackProductUsageEvent({ name: 'test_event' }, { analytics });

    expect(tracked).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it('logs and returns false when tracking fails', async () => {
    const error = new Error('track failed');
    const track = vi.fn().mockRejectedValue(error);
    const analytics = {
      getStatus: () => ({ initialized: true, providersCount: 1 }),
      track,
    } as unknown as AnalyticsManager;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const tracked = await trackProductUsageEvent({ name: 'test_event' }, { analytics });

    expect(tracked).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('Failed to track product usage event:', error);
  });
});
