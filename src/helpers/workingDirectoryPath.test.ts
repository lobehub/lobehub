import { describe, expect, it } from 'vitest';

import { resolveRemoteWorkingDirectory } from './workingDirectoryPath';

describe('resolveRemoteWorkingDirectory', () => {
  it('persists the device-normalized path after validation', () => {
    expect(
      resolveRemoteWorkingDirectory('~/projects/lobehub', {
        exists: true,
        isDirectory: true,
        path: '/home/alice/projects/lobehub',
        repoType: 'git',
      }),
    ).toEqual({
      path: '/home/alice/projects/lobehub',
      repoType: 'git',
    });
  });

  it('keeps the submitted path when an unreachable device cannot normalize it', () => {
    expect(resolveRemoteWorkingDirectory('/projects/lobehub', null)).toEqual({
      path: '/projects/lobehub',
      repoType: undefined,
    });
  });
});
