import { describe, expect, it, vi } from 'vitest';

import {
  type BoundDirectoryLike,
  normalizeComparablePath,
  pickDirectoryForPath,
  pickLatestTopic,
  resolveDirectoryMatch,
} from './openDirectorySelection';

const LOCAL = 'device-local';
const REMOTE = 'device-remote';

const directory = (
  id: string,
  path: string,
  extra: Partial<BoundDirectoryLike> = {},
): BoundDirectoryLike => ({ deviceId: LOCAL, id, path, projectId: `prj_${id}`, ...extra });

const local = { deviceId: LOCAL };

describe('normalizeComparablePath', () => {
  it('should ignore trailing separators', () => {
    expect(normalizeComparablePath('/repo/')).toBe('/repo');
    expect(normalizeComparablePath('/repo')).toBe('/repo');
  });

  it('should keep the filesystem root as a single separator', () => {
    expect(normalizeComparablePath('/')).toBe('/');
  });
});

describe('pickDirectoryForPath', () => {
  it('should prefer an exact match over an ancestor binding', () => {
    expect(
      pickDirectoryForPath(
        [directory('root', '/repo'), directory('nested', '/repo/apps')],
        '/repo/apps',
        local,
      ),
    ).toEqual({ directory: directory('nested', '/repo/apps'), matchedParent: false });
  });

  it('should match when only the trailing separator differs', () => {
    expect(pickDirectoryForPath([directory('a', '/repo/')], '/repo', local)).toEqual({
      directory: directory('a', '/repo/'),
      matchedParent: false,
    });
  });

  it('should fall back to the nearest ancestor when launched from a subfolder', () => {
    expect(
      pickDirectoryForPath(
        [
          directory('root', '/repo'),
          directory('nested', '/repo/apps/desktop'),
          directory('other', '/elsewhere'),
        ],
        '/repo/apps/desktop/src',
        local,
      ),
    ).toEqual({ directory: directory('nested', '/repo/apps/desktop'), matchedParent: true });
  });

  it('should not match a shared name prefix', () => {
    // `/repo` is not an ancestor of `/repository`.
    expect(pickDirectoryForPath([directory('a', '/repo')], '/repository', local)).toBeUndefined();
  });

  it('should prefer a runnable binding of the same path', () => {
    // A binding whose device went offline must not shadow a live one.
    expect(
      pickDirectoryForPath(
        [directory('stale', '/repo'), directory('live', '/repo', { runnable: true })],
        '/repo',
        local,
      ),
    ).toEqual({ directory: directory('live', '/repo', { runnable: true }), matchedParent: false });
  });

  it('should ignore a directory bound on another device', () => {
    // Two machines can expose the same path; only this one is being launched.
    expect(
      pickDirectoryForPath(
        [directory('remote', '/repo', { deviceId: REMOTE, runnable: true })],
        '/repo',
        local,
      ),
    ).toBeUndefined();
  });

  it('should not let a remote exact match beat a local ancestor', () => {
    expect(
      pickDirectoryForPath(
        [
          directory('local-root', '/repo', { deviceId: LOCAL }),
          directory('remote-exact', '/repo/apps', { deviceId: REMOTE }),
        ],
        '/repo/apps',
        local,
      ),
    ).toEqual({ directory: directory('local-root', '/repo'), matchedParent: true });
  });

  it('should match nothing without a local device id', () => {
    // Guessing here could open another machine's project, so the caller falls
    // back to the project list instead.
    expect(pickDirectoryForPath([directory('a', '/repo')], '/repo')).toBeUndefined();
  });

  it('should return undefined for an empty binding list', () => {
    expect(pickDirectoryForPath([], '/repo', local)).toBeUndefined();
  });
});

describe('resolveDirectoryMatch', () => {
  const base = { pollMs: 1, targetPath: '/repo', timeoutMs: 50 };

  it('should wait for the device identity before deciding it is unbound', async () => {
    // A cold-start replay outruns `gatewayDeviceInfo`; a snapshot at that moment
    // would fall through to the project list even though the directory is bound.
    const getDeviceId = vi.fn().mockReturnValueOnce(undefined).mockReturnValue(LOCAL);
    const list = vi.fn().mockResolvedValue([directory('a', '/repo')]);

    await expect(resolveDirectoryMatch({ ...base, getDeviceId, list })).resolves.toEqual({
      directory: directory('a', '/repo'),
      matchedParent: false,
    });
    expect(getDeviceId).toHaveBeenCalledTimes(2);
  });

  it('should retry an empty list instead of treating it as unbound', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([directory('a', '/repo')]);

    await expect(
      resolveDirectoryMatch({ ...base, getDeviceId: () => LOCAL, list }),
    ).resolves.toMatchObject({ directory: { id: 'a' } });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('should survive a failing call', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('401'))
      .mockResolvedValueOnce([directory('a', '/repo')]);

    await expect(
      resolveDirectoryMatch({ ...base, getDeviceId: () => LOCAL, list }),
    ).resolves.toMatchObject({ directory: { id: 'a' } });
  });

  it('should give up at the deadline and report no match', async () => {
    const list = vi.fn().mockResolvedValue([]);

    await expect(
      resolveDirectoryMatch({ ...base, getDeviceId: () => LOCAL, list, timeoutMs: 5 }),
    ).resolves.toBeUndefined();
  });
});

describe('pickLatestTopic', () => {
  it('should pick the newest topic regardless of list order', () => {
    // `listTopics` returns ascending `updatedAt`; the rule must not depend on it.
    expect(
      pickLatestTopic([
        { id: 'old', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'new', updatedAt: '2026-11-01T00:00:00Z' },
        { id: 'mid', updatedAt: new Date('2026-06-01T00:00:00Z') },
      ])?.id,
    ).toBe('new');
  });

  it('should return undefined without topics', () => {
    expect(pickLatestTopic([])).toBeUndefined();
  });
});
