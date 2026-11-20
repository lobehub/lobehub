import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LIVE_TAB_ROUTER_CAP, useLiveTabRouterCap } from './liveTabRouterCap';

describe('useLiveTabRouterCap', () => {
  beforeEach(() => {
    localStorage.clear();
    useLiveTabRouterCap.setState({ cap: DEFAULT_LIVE_TAB_ROUTER_CAP });
  });

  it('persists a valid cap', () => {
    useLiveTabRouterCap.getState().setCap(7);

    expect(useLiveTabRouterCap.getState().cap).toBe(7);
    expect(localStorage.getItem('LOBE_LIVE_TAB_ROUTER_CAP')).toBe('7');
  });

  it.each([0, -1, 2.5, Number.NaN])('ignores invalid cap %s', (value) => {
    useLiveTabRouterCap.getState().setCap(value);

    expect(useLiveTabRouterCap.getState().cap).toBe(DEFAULT_LIVE_TAB_ROUTER_CAP);
    expect(localStorage.getItem('LOBE_LIVE_TAB_ROUTER_CAP')).toBeNull();
  });
});
