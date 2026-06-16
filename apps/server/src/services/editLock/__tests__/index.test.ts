import { describe, expect, it, vi } from 'vitest';

import { EditLockService } from '../index';

/**
 * Minimal in-memory fake of the ioredis calls EditLockService uses:
 * `set(k, v, 'EX', ttl[, 'NX'])`, `get(k)`, and the compare-and-delete `eval`.
 */
const makeFakeRedis = () => {
  const store = new Map<string, string>();
  return {
    eval: vi.fn(async (_script: string, _numKeys: number, key: string, arg: string) => {
      const raw = store.get(key);
      if (!raw) return 0;
      let matches = raw === arg;
      try {
        matches = matches || JSON.parse(raw).ownerId === arg;
      } catch {}
      if (matches) {
        store.delete(key);
        return 1;
      }
      return 0;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    store,
  };
};

describe('EditLockService', () => {
  it('acquires a free lock and reports the caller as holder', async () => {
    const redis = makeFakeRedis();
    const svc = new EditLockService('user-1', redis as any);

    const result = await svc.acquire('document', 'doc-1', 'owner-1');

    expect(result.holderId).toBe('user-1');
    expect(result.ownerId).toBe('owner-1');
    expect(result.lockedByOther).toBe(false);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(JSON.parse(redis.store.get('editlock:document:doc-1')!)).toEqual(
      expect.objectContaining({ ownerId: 'owner-1', userId: 'user-1' }),
    );
  });

  it('reports another member as holder when the lock is already taken', async () => {
    const redis = makeFakeRedis();
    await new EditLockService('user-1', redis as any).acquire('document', 'doc-1', 'owner-1');

    const result = await new EditLockService('user-2', redis as any).acquire('document', 'doc-1');

    expect(result).toEqual(
      expect.objectContaining({ holderId: 'user-1', lockedByOther: true, ownerId: 'owner-1' }),
    );
  });

  it('lets the holder refresh their own lease', async () => {
    const redis = makeFakeRedis();
    const svc = new EditLockService('user-1', redis as any);
    await svc.acquire('document', 'doc-1', 'owner-1');

    const result = await svc.acquire('document', 'doc-1', 'owner-1');

    expect(result.holderId).toBe('user-1');
    expect(result.ownerId).toBe('owner-1');
    expect(result.lockedByOther).toBe(false);
  });

  it('treats the same user in another edit session as blocked', async () => {
    const redis = makeFakeRedis();
    await new EditLockService('user-1', redis as any).acquire('document', 'doc-1', 'owner-1');

    const result = await new EditLockService('user-1', redis as any).acquire(
      'document',
      'doc-1',
      'owner-2',
    );

    expect(result).toEqual(
      expect.objectContaining({ holderId: 'user-1', lockedByOther: true, ownerId: 'owner-1' }),
    );
  });

  it('getActiveHolder reports the current holder, or undefined when free', async () => {
    const redis = makeFakeRedis();
    expect(
      await new EditLockService('user-1', redis as any).getActiveHolder('document', 'doc-1'),
    ).toBeUndefined();

    await new EditLockService('user-1', redis as any).acquire('document', 'doc-1', 'owner-1');
    expect(
      await new EditLockService('user-2', redis as any).getActiveHolder('document', 'doc-1'),
    ).toBe('user-1');
  });

  it('keys locks per resource type, so the same id does not collide across types', async () => {
    const redis = makeFakeRedis();
    await new EditLockService('user-1', redis as any).acquire('document', 'shared-id', 'owner-1');

    // A different resource family with the same id is independently lockable.
    const result = await new EditLockService('user-2', redis as any).acquire('agent', 'shared-id');

    expect(result.holderId).toBe('user-2');
    expect(result.lockedByOther).toBe(false);
    expect(JSON.parse(redis.store.get('editlock:document:shared-id')!)).toEqual(
      expect.objectContaining({ userId: 'user-1' }),
    );
    expect(JSON.parse(redis.store.get('editlock:agent:shared-id')!)).toEqual(
      expect.objectContaining({ userId: 'user-2' }),
    );
  });

  it('getBlockingHolder returns the holder only when it is someone else', async () => {
    const redis = makeFakeRedis();
    await new EditLockService('user-1', redis as any).acquire('document', 'doc-1', 'owner-1');

    expect(
      await new EditLockService('user-2', redis as any).getBlockingHolder('document', 'doc-1'),
    ).toBe('user-1');
    expect(
      await new EditLockService('user-1', redis as any).getBlockingHolder(
        'document',
        'doc-1',
        'owner-1',
      ),
    ).toBeNull();
    expect(
      await new EditLockService('user-1', redis as any).getBlockingHolder(
        'document',
        'doc-1',
        'owner-2',
      ),
    ).toBe('user-1');
  });

  it('only releases the lock for the current owner', async () => {
    const redis = makeFakeRedis();
    await new EditLockService('user-1', redis as any).acquire('document', 'doc-1', 'owner-1');

    // A non-owner release is a no-op and reports it did not release.
    expect(
      await new EditLockService('user-1', redis as any).release('document', 'doc-1', 'owner-2'),
    ).toBe(false);
    expect(JSON.parse(redis.store.get('editlock:document:doc-1')!)).toEqual(
      expect.objectContaining({ ownerId: 'owner-1' }),
    );

    // The owner can release, and reports the lock was actually freed.
    expect(
      await new EditLockService('user-1', redis as any).release('document', 'doc-1', 'owner-1'),
    ).toBe(true);
    expect(redis.store.has('editlock:document:doc-1')).toBe(false);
  });

  it('requires a matching owner id for owner-scoped writes', async () => {
    const redis = makeFakeRedis();
    const svc = new EditLockService('user-1', redis as any);
    await svc.acquire('document', 'doc-1', 'owner-1');

    await expect(svc.canWrite('document', 'doc-1', 'owner-1')).resolves.toBe(true);
    await expect(svc.canWrite('document', 'doc-1', 'owner-2')).resolves.toBe(false);
    await expect(svc.canWrite('document', 'doc-1')).resolves.toBe(false);
    redis.store.delete('editlock:document:doc-1');
    await expect(svc.canWrite('document', 'doc-1', 'owner-1')).resolves.toBe(false);
    await expect(svc.canWrite('document', 'doc-1')).resolves.toBe(true);
  });

  it('degrades to unlocked / no-op when Redis is unavailable', async () => {
    const svc = new EditLockService('user-1', null);

    expect(await svc.acquire('document', 'doc-1')).toEqual({
      expiresAt: null,
      holderId: null,
      lockedByOther: false,
      ownerId: null,
    });
    expect(await svc.getBlockingHolder('document', 'doc-1')).toBeNull();
    await expect(svc.release('document', 'doc-1')).resolves.toBe(false);
  });

  it('fails open when Redis is configured but commands reject (unreachable)', async () => {
    // ioredis is non-null but every command rejects after retries — the write
    // guards must not turn this into a 500; treat the resource as unlocked.
    const down = new Error('Connection is closed.');
    const redis = {
      eval: vi.fn().mockRejectedValue(down),
      get: vi.fn().mockRejectedValue(down),
      set: vi.fn().mockRejectedValue(down),
    };
    const svc = new EditLockService('user-1', redis as any);

    expect(await svc.acquire('document', 'doc-1')).toEqual({
      expiresAt: null,
      holderId: null,
      lockedByOther: false,
      ownerId: null,
    });
    expect(await svc.getActiveHolder('document', 'doc-1')).toBeUndefined();
    expect(await svc.getBlockingHolder('document', 'doc-1')).toBeNull();
    await expect(svc.canWrite('document', 'doc-1', 'owner-1')).resolves.toBe(true);
    await expect(svc.release('document', 'doc-1')).resolves.toBe(false);
  });
});
