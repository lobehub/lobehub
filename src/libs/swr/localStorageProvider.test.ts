/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskTemplateKeys } from './keys';
import { buildLocalDataKey, localDataCache } from './localDataCache';
import {
  CACHE_TIERS,
  clearSWRCache,
  createCacheProvider,
  getScopedCacheKey,
} from './localStorageProvider';

/** Poll until `fn` returns truthy (for async IndexedDB tier assertions). */
const until = async (fn: () => boolean | Promise<boolean>, timeout = 1000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('until: timed out');
};

/** Build a provider whose async IndexedDB hydration we can await. */
const buildProvider = (
  scope: { value: string },
  extra: Partial<Parameters<typeof createCacheProvider>[0]> = {},
) => {
  let resolveHydrated: () => void;
  const hydrated = new Promise<void>((r) => {
    resolveHydrated = r;
  });
  const provider = createCacheProvider({
    debounceMs: 5,
    getScope: () => scope.value,
    idbPatterns: ['MSGS', 'TOPIC'],
    localPatterns: ['recents'],
    onScopeHydrated: () => resolveHydrated(),
    ...extra,
  });
  return { hydrated, provider };
};

describe('createCacheProvider — tiering', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await localDataCache.clearScope('s1');
    await localDataCache.clearScope('s2');
  });

  it('getScopedCacheKey namespaces by scope', () => {
    expect(getScopedCacheKey('u1:personal')).toBe('lobechat-swr-cache:u1:personal');
    expect(getScopedCacheKey('anon:personal')).not.toBe(getScopedCacheKey('u1:personal'));
  });

  it('routes local-tier keys to scoped localStorage only', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope);
    const map = provider();

    map.set('recents', { items: [1] });
    map.set('MSGS:t1', { items: [2] }); // idb tier
    map.set('random', { x: 1 }); // memory only

    await until(() => localStorage.getItem(getScopedCacheKey('s1')) !== null);

    const stored = JSON.parse(localStorage.getItem(getScopedCacheKey('s1'))!);
    const keys = stored.map(([k]: [string]) => k);
    expect(keys).toContain('recents');
    expect(keys).not.toContain('MSGS:t1');
    expect(keys).not.toContain('random');
  });

  it('persists task-template recommendation keys in the local tier', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, {
      idbPatterns: [...CACHE_TIERS.idb],
      localPatterns: [...CACHE_TIERS.local],
    });
    const map = provider();
    const key = JSON.stringify(taskTemplateKeys.listDailyRecommend('', 3, 'zh-CN'));

    map.set(key, { data: [{ id: 1, title: 'Daily brief' }] });

    await until(() => localStorage.getItem(getScopedCacheKey('s1')) !== null);

    const stored = JSON.parse(localStorage.getItem(getScopedCacheKey('s1'))!);
    expect(stored.map(([k]: [string]) => k)).toContain(key);
    expect(await localDataCache.entriesByScope('s1')).toEqual([]);
  });

  it('persists model config keys in the local tier', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, {
      idbPatterns: [...CACHE_TIERS.idb],
      localPatterns: [...CACHE_TIERS.local],
    });
    const map = provider();
    const key = 'modelConfig:lobehub';

    map.set(key, { data: { homeNewModels: [{ model: 'gpt-image-2', type: 'image' }] } });

    await until(() => localStorage.getItem(getScopedCacheKey('s1')) !== null);

    const stored = JSON.parse(localStorage.getItem(getScopedCacheKey('s1'))!);
    expect(stored.map(([k]: [string]) => k)).toContain(key);
    expect(await localDataCache.entriesByScope('s1')).toEqual([]);
  });

  it('routes idb-tier keys to IndexedDB and reloads them on a fresh provider', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope);
    const map = provider();

    map.set('MSGS:t1', { items: ['hello'] });
    await until(async () => (await localDataCache.entriesByScope('s1')).length > 0);

    // a brand-new provider for the same scope should re-hydrate the idb entry
    const { hydrated: hydrated2, provider: provider2 } = buildProvider(scope);
    const map2 = provider2();
    await hydrated2;

    expect(map2.get('MSGS:t1')).toEqual({ items: ['hello'] });
  });

  it('idb tier wins when a key matches both pattern sets', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, {
      idbPatterns: ['shared'],
      localPatterns: ['shared'],
    });
    const map = provider();
    map.set('shared-key', { v: 1 });

    await until(async () => (await localDataCache.entriesByScope('s1')).length > 0);
    // not written to the localStorage tier
    expect(localStorage.getItem(getScopedCacheKey('s1'))).toBeNull();
  });

  it('does not let two scopes overwrite each other (both tiers)', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope);
    const map = provider();
    map.set('recents', { owner: 'A' });
    map.set('MSGS:t1', { owner: 'A' });
    await until(async () => (await localDataCache.entriesByScope('s1')).length > 0);
    await until(() => localStorage.getItem(getScopedCacheKey('s1')) !== null);

    // switch scope and write different data
    scope.value = 's2';
    provider.reloadScope!();
    map.set('recents', { owner: 'B' });
    map.set('MSGS:t1', { owner: 'B' });
    await until(async () => (await localDataCache.entriesByScope('s2')).length > 0);
    await until(() => localStorage.getItem(getScopedCacheKey('s2')) !== null);

    const a = await localDataCache.entriesByScope('s1');
    const b = await localDataCache.entriesByScope('s2');
    expect(a.find((e) => e.key === 'MSGS:t1')?.data).toEqual({ owner: 'A' });
    expect(b.find((e) => e.key === 'MSGS:t1')?.data).toEqual({ owner: 'B' });
  });

  it('reloadScope re-hydrates both tiers from the new scope', async () => {
    // seed s2 with idb + local data via a throwaway provider
    const seedScope = { value: 's2' };
    const { provider: seed } = buildProvider(seedScope);
    const seedMap = seed();
    seedMap.set('MSGS:tX', { from: 's2' });
    seedMap.set('recents', { from: 's2' });
    await until(async () => (await localDataCache.entriesByScope('s2')).length > 0);
    await until(() => localStorage.getItem(getScopedCacheKey('s2')) !== null);

    // a provider that starts on s1, then switches to s2
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope);
    const map = provider();
    map.set('MSGS:tA', { from: 's1' });
    map.set('recents', { from: 's1' });

    scope.value = 's2';
    provider.reloadScope!();

    // local tier is synchronous on reload
    expect(map.get('recents')).toEqual({ from: 's2' });
    // s1's idb entry dropped from memory
    expect(map.has('MSGS:tA')).toBe(false);
    // s2's idb entry hydrated asynchronously
    await until(() => map.get('MSGS:tX') !== undefined);
    expect(map.get('MSGS:tX')).toEqual({ from: 's2' });
  });

  it('drops local-tier entries past TTL / version on load', async () => {
    const key = getScopedCacheKey('s1');
    localStorage.setItem(
      key,
      JSON.stringify([
        ['recents', { data: { ok: true }, timestamp: Date.now(), version: '1.0.0' }],
        ['recents-old', { data: { ok: false }, timestamp: Date.now() - 1e9, version: '1.0.0' }],
        ['recents-v', { data: { ok: false }, timestamp: Date.now(), version: '0.0.1' }],
      ]),
    );
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, { ttl: 60_000, version: '1.0.0' });
    const map = provider();

    expect(map.get('recents')).toEqual({ ok: true });
    expect(map.has('recents-old')).toBe(false);
    expect(map.has('recents-v')).toBe(false);
  });

  it('hydrates idb-tier entries regardless of age (never expires)', async () => {
    // seed an idb entry via a throwaway provider
    const seedScope = { value: 's1' };
    const { provider: seed } = buildProvider(seedScope);
    seed().set('MSGS:old', { ok: true });
    await until(async () => (await localDataCache.entriesByScope('s1')).length > 0);

    // a fresh provider with an absurdly small TTL — the row is well past it
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, { ttl: 1 });
    const map = provider();

    // idb tier ignores TTL: the stale row still hydrates (stale-while-revalidate)
    await until(() => map.get('MSGS:old') !== undefined);
    expect(map.get('MSGS:old')).toEqual({ ok: true });
  });

  it('drops idb-tier entries on version mismatch', async () => {
    // seed an idb entry under a different app version
    const seedScope = { value: 's1' };
    const { provider: seed } = buildProvider(seedScope, { version: '9.9.9' });
    seed().set('MSGS:stale', { ok: false });
    await until(async () => (await localDataCache.entriesByScope('s1')).length > 0);

    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, { version: '1.0.0' });
    const map = provider();

    // give async hydration a chance, then assert it never lands
    await new Promise((r) => setTimeout(r, 40));
    expect(map.has('MSGS:stale')).toBe(false);
  });

  it('drops legacy idb rows that carry no cache version', async () => {
    // seed a row directly with no version (pre-versioning / non-conforming writer)
    await localDataCache.set(buildLocalDataKey('s1', 'MSGS:legacy'), { ok: false });

    const scope = { value: 's1' };
    const { provider } = buildProvider(scope, { version: '1.0.0' });
    const map = provider();

    await new Promise((r) => setTimeout(r, 40));
    expect(map.has('MSGS:legacy')).toBe(false);
  });

  it('handles localStorage QuotaExceededError without throwing', async () => {
    const scope = { value: 's1' };
    const { provider } = buildProvider(scope);
    const map = provider();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(() => {
      map.set('recents', { x: 1 });
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });

  it('exposes the central tier config keyed by domain prefix', () => {
    expect(CACHE_TIERS.idb).toContain('message:');
    expect(CACHE_TIERS.idb).toContain('topic:');
    expect(CACHE_TIERS.local).toContain('recent:list');
    expect(CACHE_TIERS.local).toContain('taskTemplate:');
    expect(CACHE_TIERS.local).toContain('modelConfig:');
  });
});

describe('clearSWRCache', () => {
  beforeEach(() => localStorage.clear());

  it('removes the given cache key', () => {
    localStorage.setItem('lobechat-swr-cache', '[]');
    clearSWRCache();
    expect(localStorage.getItem('lobechat-swr-cache')).toBeNull();
  });
});
