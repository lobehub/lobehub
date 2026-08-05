import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getOrCreateTabRouter,
  resetTabRouterManager,
  syncTabRouters,
  type TabRouter,
} from './tabRouterManager';

const makeRouter = (url: string): TabRouter =>
  createMemoryRouter([{ element: null, path: '/item/:id' }], { initialEntries: [url] });

afterEach(() => {
  resetTabRouterManager();
});

describe('tabRouterManager', () => {
  it('returns the same instance for a tabId and ignores the url on later calls', () => {
    const first = getOrCreateTabRouter('t1', '/item/a', makeRouter);
    const again = getOrCreateTabRouter('t1', '/item/b', makeRouter);

    expect(again).toBe(first);
    expect(again.state.location.pathname).toBe('/item/a');
  });

  it('disposes routers absent from the live list and recreates them fresh afterwards', () => {
    const original = getOrCreateTabRouter('t1', '/item/a', makeRouter);

    syncTabRouters([]);

    const recreated = getOrCreateTabRouter('t1', '/item/b', makeRouter);

    expect(recreated).not.toBe(original);
    expect(recreated.state.location.pathname).toBe('/item/b');
  });
});
