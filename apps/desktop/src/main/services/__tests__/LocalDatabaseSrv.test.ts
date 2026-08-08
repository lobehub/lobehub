import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import LocalDatabaseService from '../LocalDatabaseSrv';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn() }),
}));

describe('LocalDatabaseService', () => {
  let storagePath: string;
  let service: LocalDatabaseService;

  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-local-database-'));
    service = new LocalDatabaseService({ appStoragePath: storagePath } as App);
  });

  afterEach(async () => {
    service.destroy();
    await rm(storagePath, { force: true, recursive: true });
  });

  it('isolates collections and supports prefix queries and deletes', async () => {
    await service.set('first', 'scope-a::1', 'first-1');
    await service.set('first', 'scope-a::2', 'first-2');
    await service.set('first', 'scope-b::1', 'first-3');
    await service.set('second', 'scope-a::1', 'second-1');

    await expect(service.entriesByPrefix('first', 'scope-a::')).resolves.toEqual([
      { key: 'scope-a::1', value: 'first-1' },
      { key: 'scope-a::2', value: 'first-2' },
    ]);

    await service.deleteByPrefix('first', 'scope-a::');

    await expect(service.entriesByPrefix('first', '')).resolves.toEqual([
      { key: 'scope-b::1', value: 'first-3' },
    ]);
    await expect(service.get('second', 'scope-a::1')).resolves.toBe('second-1');
  });

  it('preserves keys when collection names contain key-like delimiters', async () => {
    await service.set('cache:1', ':scope::1', 'first');
    await service.set('cache', '1:scope::1', 'second');

    await expect(service.entriesByPrefix('cache:1', ':scope::')).resolves.toEqual([
      { key: ':scope::1', value: 'first' },
    ]);
    await expect(service.entriesByPrefix('cache', '1:scope::')).resolves.toEqual([
      { key: '1:scope::1', value: 'second' },
    ]);
  });

  it('commits mixed batch operations atomically', async () => {
    await service.set('cache', 'legacy', 'old');
    await service.batch([
      { collection: 'cache', key: 'replacement', type: 'set', value: 'new' },
      { collection: 'cache', key: 'legacy', type: 'delete' },
    ]);

    await expect(service.get('cache', 'legacy')).resolves.toBeUndefined();
    await expect(service.get('cache', 'replacement')).resolves.toBe('new');
  });

  it('rolls back the entire batch when one operation fails', async () => {
    await expect(
      service.batch([
        { collection: 'cache', key: 'first', type: 'set', value: 'written-before-error' },
        {
          collection: 'cache',
          key: 'invalid',
          type: 'set',
          value: null as unknown as string,
        },
      ]),
    ).rejects.toThrow();

    await expect(service.get('cache', 'first')).resolves.toBeUndefined();
  });
});
