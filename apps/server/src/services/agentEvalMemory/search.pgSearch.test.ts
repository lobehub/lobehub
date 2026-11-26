import type { LobeChatDatabase } from '@lobechat/database';
import { describe, expect, it, vi } from 'vitest';

import { hasPgSearch } from './search';

describe('evaluation Memory pg_search detection', () => {
  it('retries a failed probe so a temporary outage does not disable later lexical searches', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('Temporary database connection failure'))
      .mockResolvedValue({ rows: [{ exists: 1 }] });
    const db = { execute } as unknown as LobeChatDatabase;

    await expect(hasPgSearch(db)).resolves.toBe(false);
    await expect(hasPgSearch(db)).resolves.toBe(true);
    await expect(hasPgSearch(db)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('remembers a successful probe that confirms pg_search is unavailable', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const db = { execute } as unknown as LobeChatDatabase;

    await expect(hasPgSearch(db)).resolves.toBe(false);
    await expect(hasPgSearch(db)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight probe among concurrent searches', async () => {
    let resolveProbe!: (result: { rows: object[] }) => void;
    const execute = vi.fn(
      () =>
        new Promise<{ rows: object[] }>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const db = { execute } as unknown as LobeChatDatabase;

    const searches = [hasPgSearch(db), hasPgSearch(db), hasPgSearch(db)];
    expect(execute).toHaveBeenCalledTimes(1);
    resolveProbe({ rows: [{ exists: 1 }] });
    await expect(Promise.all(searches)).resolves.toEqual([true, true, true]);
    await expect(hasPgSearch(db)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
