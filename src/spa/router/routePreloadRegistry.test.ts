import { describe, expect, it, vi } from 'vitest';

import { preloadRegisteredRoute, registerRoutePreloadLoader } from './routePreloadRegistry';

describe('routePreloadRegistry', () => {
  it('preloads every lazy route module registered in the same business group', async () => {
    const loadLayout = vi.fn().mockResolvedValue(undefined);
    const loadPage = vi.fn().mockResolvedValue(undefined);
    registerRoutePreloadLoader('test-agents', loadLayout);
    registerRoutePreloadLoader('test-agents', loadPage);

    await preloadRegisteredRoute('test-agents');

    expect(loadLayout).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it('treats an unregistered group as a no-op', async () => {
    await expect(preloadRegisteredRoute('test-missing')).resolves.toBeUndefined();
  });
});
