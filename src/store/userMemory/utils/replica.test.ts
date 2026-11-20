import { describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';

import { clearReplicas, identityScopeOf, userMemoryIdentityScope } from './replica';

describe('userMemory replica scope', () => {
  it('drops the workspace from the cache scope', () => {
    expect(identityScopeOf('user-1:personal')).toBe('user-1:*');
    expect(identityScopeOf('user-1:ws-2')).toBe('user-1:*');
    expect(identityScopeOf('anon')).toBe('anon:*');
  });

  it('maps every workspace of one user to the same partition', () => {
    const get = vi.spyOn(cacheScope, 'get').mockReturnValue('user-1:personal');
    const personal = userMemoryIdentityScope.get();
    get.mockReturnValue('user-1:ws-2');
    expect(userMemoryIdentityScope.get()).toBe(personal);
    get.mockReturnValue('user-2:personal');
    expect(userMemoryIdentityScope.get()).not.toBe(personal);
    vi.restoreAllMocks();
  });
});

describe('clearReplicas', () => {
  it('clears every replica once when storage is purged', async () => {
    const a = vi.fn().mockResolvedValue(true);
    const b = vi.fn().mockResolvedValue(true);

    await expect(clearReplicas(a, b)).resolves.toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('retries a failed purge once', async () => {
    const flaky = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);

    await expect(clearReplicas(flaky)).resolves.toBe(true);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('reports a persisted row that survived both attempts', async () => {
    const broken = vi.fn().mockResolvedValue(false);
    const fine = vi.fn().mockResolvedValue(true);

    await expect(clearReplicas(fine, broken)).resolves.toBe(false);
    expect(broken).toHaveBeenCalledTimes(2);
  });
});
