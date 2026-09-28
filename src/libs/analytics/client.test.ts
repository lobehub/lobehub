import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __testing, analyticsClient, loadAnalytics } from './client';

const fake = vi.hoisted(() => ({
  getProvider: vi.fn(),
  identify: vi.fn(),
  initialize: vi.fn().mockResolvedValue(undefined),
  setGlobalContext: vi.fn(),
  track: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@lobehub/analytics', () => ({ createSingletonAnalytics: () => fake }));

const config = {
  ga4: { enabled: false, measurementId: '' },
  posthog: { enabled: false, host: '', key: '' },
  xAds: { enabled: false, pixelId: '' },
} as Parameters<typeof loadAnalytics>[0];

describe('analytics client', () => {
  beforeEach(() => {
    __testing.reset();
    vi.clearAllMocks();
  });

  it('queues events fired before the library loads and flushes them in order', async () => {
    void analyticsClient.track({ name: 'first' });
    analyticsClient.identify('u1', { email: 'a@b.c' });
    void analyticsClient.track({ name: 'second' });

    expect(fake.track).not.toHaveBeenCalled();

    await loadAnalytics(config);

    expect(fake.track.mock.calls.map(([event]) => event.name)).toEqual(['first', 'second']);
    expect(fake.identify).toHaveBeenCalledWith('u1', { email: 'a@b.c' });
  });

  it('forwards directly once loaded', async () => {
    await loadAnalytics(config);
    await analyticsClient.track({ name: 'live' });

    expect(fake.track).toHaveBeenCalledWith({ name: 'live' });
  });

  it('loads the library only once', async () => {
    await Promise.all([loadAnalytics(config), loadAnalytics(config)]);

    expect(fake.initialize).toHaveBeenCalledTimes(1);
  });
});
