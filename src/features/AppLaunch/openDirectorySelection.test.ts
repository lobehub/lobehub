import { describe, expect, it } from 'vitest';

import {
  type BoundDirectoryLike,
  normalizeComparablePath,
  pickDirectoryForPath,
  pickLatestTopic,
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
