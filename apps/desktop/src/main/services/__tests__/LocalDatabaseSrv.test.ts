import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import LocalDatabaseService from '../LocalDatabaseSrv';

vi.mock('electron', () => ({ app: { once: vi.fn() } }));
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

  it('isolates collections and supports prefix queries and deletes', () => {
    service.set('first', 'scope-a::1', 'first-1');
    service.set('first', 'scope-a::2', 'first-2');
    service.set('first', 'scope-b::1', 'first-3');
    service.set('second', 'scope-a::1', 'second-1');

    expect(service.entriesByPrefix('first', 'scope-a::')).toEqual([
      { key: 'scope-a::1', value: 'first-1' },
      { key: 'scope-a::2', value: 'first-2' },
    ]);

    service.deleteByPrefix('first', 'scope-a::');

    expect(service.entriesByPrefix('first', '')).toEqual([{ key: 'scope-b::1', value: 'first-3' }]);
    expect(service.get('second', 'scope-a::1')?.value).toBe('second-1');
  });

  it('commits mixed batch operations atomically', () => {
    service.set('cache', 'legacy', 'old');
    service.batch([
      { collection: 'cache', key: 'replacement', type: 'set', value: 'new' },
      { collection: 'cache', key: 'legacy', type: 'delete' },
    ]);

    expect(service.get('cache', 'legacy')).toBeUndefined();
    expect(service.get('cache', 'replacement')?.value).toBe('new');
  });

  it('rolls back the entire batch when one operation fails', () => {
    expect(() =>
      service.batch([
        { collection: 'cache', key: 'first', type: 'set', value: 'written-before-error' },
        {
          collection: 'cache',
          key: 'invalid',
          type: 'set',
          value: null as unknown as string,
        },
      ]),
    ).toThrow();

    expect(service.get('cache', 'first')).toBeUndefined();
  });
});
