import { afterEach, describe, expect, it, vi } from 'vitest';

import { expose } from './expose';

const envState = vi.hoisted(() => ({ isDev: false }));
vi.mock('@/utils/env', () => ({
  get isDev() {
    return envState.isDev;
  },
}));

const store = { getState: () => ({ count: 1 }) };

describe('expose', () => {
  afterEach(() => {
    envState.isDev = false;
    delete window.__LOBE_STORES;
    delete window.lobeEnv;
  });

  it('keeps production stores private', () => {
    expose('counter', store);

    expect(window.__LOBE_STORES).toBeUndefined();
  });

  it('exposes stores in development', () => {
    envState.isDev = true;

    expose('counter', store);

    expect(window.__LOBE_STORES?.counter()).toEqual({ count: 1 });
  });

  it('exposes production stores while Desktop remote debugging is on', () => {
    window.lobeEnv = { exposeStores: true };

    expose('counter', store);

    expect(window.__LOBE_STORES?.counter()).toEqual({ count: 1 });
  });
});
