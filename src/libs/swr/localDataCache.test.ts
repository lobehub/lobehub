import { beforeEach, describe, expect, it } from 'vitest';

import { buildLocalDataKey, localDataCache } from './localDataCache';

describe('buildLocalDataKey', () => {
  it('joins scope and string key', () => {
    expect(buildLocalDataKey('user-1:personal', 'fetchMessages')).toBe(
      'user-1:personal::fetchMessages',
    );
  });

  it('serializes array/object keys', () => {
    expect(buildLocalDataKey('u:w', ['message:list', { topicId: 't1' }])).toBe(
      'u:w::["message:list",{"topicId":"t1"}]',
    );
  });

  it('partitions identical SWR keys by scope', () => {
    const key = ['message:list', { topicId: 't1' }];
    expect(buildLocalDataKey('userA:personal', key)).not.toBe(
      buildLocalDataKey('userB:personal', key),
    );
  });
});

describe('localDataCache', () => {
  const scope = 'user-test:personal';

  beforeEach(async () => {
    await localDataCache.clearScope(scope);
  });

  it('stores and retrieves data', async () => {
    const key = buildLocalDataKey(scope, ['msgs', 't1']);
    await localDataCache.set(key, [{ content: 'hello', id: 'm1' }]);

    const got = await localDataCache.get<{ content: string; id: string }[]>(key);
    expect(got).toEqual([{ content: 'hello', id: 'm1' }]);
  });

  it('returns undefined for a missing key', async () => {
    const got = await localDataCache.get(buildLocalDataKey(scope, 'missing'));
    expect(got).toBeUndefined();
  });

  it('overwrites on repeated set (last write wins)', async () => {
    const key = buildLocalDataKey(scope, 'k');
    await localDataCache.set(key, { v: 1 });
    await localDataCache.set(key, { v: 2 });

    expect(await localDataCache.get(key)).toEqual({ v: 2 });
  });

  it('deletes a key', async () => {
    const key = buildLocalDataKey(scope, 'k');
    await localDataCache.set(key, { v: 1 });
    await localDataCache.delete(key);

    expect(await localDataCache.get(key)).toBeUndefined();
  });

  it('clearScope removes only the given scope', async () => {
    const otherScope = 'user-other:personal';
    const keyA = buildLocalDataKey(scope, 'a');
    const keyB = buildLocalDataKey(otherScope, 'b');
    await localDataCache.set(keyA, 1);
    await localDataCache.set(keyB, 2);

    await localDataCache.clearScope(scope);

    expect(await localDataCache.get(keyA)).toBeUndefined();
    expect(await localDataCache.get(keyB)).toBe(2);

    await localDataCache.clearScope(otherScope);
  });
});
