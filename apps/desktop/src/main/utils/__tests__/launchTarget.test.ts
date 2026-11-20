import { describe, expect, it } from 'vitest';

import { createPathTarget, parseLaunchArgs } from '../launchTarget';

const directories = new Set(['/repo', '/repo/apps', '/tmp', '/Users/me/Code/app']);

const options = {
  cwd: '/repo',
  isDirectory: (candidate: string) => directories.has(candidate),
  resolveRealPath: (candidate: string) => candidate,
  schemes: ['lobehub', 'lobehub-nightly'],
};

describe('parseLaunchArgs', () => {
  it('should open a bare directory argument', () => {
    expect(
      parseLaunchArgs(
        ['/Applications/LobeHub.app/Contents/MacOS/LobeHub', '/Users/me/Code/app'],
        options,
      ),
    ).toEqual({ kind: 'path', newWindow: false, path: '/Users/me/Code/app' });
  });

  it('should prefer the explicit --open-path argument', () => {
    expect(parseLaunchArgs(['/x/LobeHub', '--open-path', '/tmp'], options)).toEqual({
      kind: 'path',
      newWindow: false,
      path: '/tmp',
    });
  });

  it('should carry --new-window without treating it as the target', () => {
    expect(parseLaunchArgs(['/x/LobeHub', '-n', '/tmp'], options)).toEqual({
      kind: 'path',
      newWindow: true,
      path: '/tmp',
    });
  });

  it('should resolve a relative path against the caller cwd', () => {
    expect(parseLaunchArgs(['/x/LobeHub', '.'], options)).toMatchObject({ path: '/repo' });
  });

  it('should dispatch a deep link instead of resolving it as a path', () => {
    expect(
      parseLaunchArgs(['/x/LobeHub', '/tmp', 'lobehub://plugin/install?id=1'], options),
    ).toEqual({ kind: 'url', url: 'lobehub://plugin/install?id=1' });
  });

  it('should match the scheme case-insensitively', () => {
    expect(parseLaunchArgs(['/x/LobeHub', 'LobeHub://agent/open'], options)).toEqual({
      kind: 'url',
      url: 'LobeHub://agent/open',
    });
  });

  it('should return null when nothing resolves', () => {
    expect(parseLaunchArgs(['/x/LobeHub'], options)).toBeNull();
    expect(parseLaunchArgs(['/x/LobeHub', '/does/not/exist'], options)).toBeNull();
    expect(parseLaunchArgs(['/x/LobeHub', '--some-flag'], options)).toBeNull();
  });

  it('should drop the app own directory in a development launch', () => {
    expect(
      parseLaunchArgs(['/abs/electron', '/repo', '/Users/me/Code/app'], {
        ...options,
        appPaths: ['/repo'],
      }),
    ).toEqual({ kind: 'path', newWindow: false, path: '/Users/me/Code/app' });

    // A lone self-path must open nothing rather than the source tree.
    expect(parseLaunchArgs(['/abs/electron', '.'], { ...options, appPaths: ['/repo'] })).toBeNull();
  });

  it('should refuse network paths', () => {
    // SMB confuses credential handling and hangs the main process on launch.
    expect(parseLaunchArgs(['/x/LobeHub', '//server/share/project'], options)).toBeNull();
    expect(parseLaunchArgs(['/x/LobeHub', '\\\\server\\share\\project'], options)).toBeNull();
  });

  it('should take the last directory positional', () => {
    expect(parseLaunchArgs(['/x/LobeHub', '/tmp', '/Users/me/Code/app'], options)).toMatchObject({
      path: '/Users/me/Code/app',
    });
  });

  it('should stop flag parsing after --', () => {
    expect(parseLaunchArgs(['/x/LobeHub', '--', '/tmp'], options)).toMatchObject({ path: '/tmp' });
  });

  it('should still open the directory when Electron reorders argv', () => {
    // Observed on a real second-instance handoff: Electron moves switches ahead
    // of positionals, which separates `--open-path` from its value and leaves
    // the directory last. Failing on that must not drop the launch.
    expect(
      parseLaunchArgs(
        [
          '/Electron',
          '--open-path',
          '--allow-file-access-from-files',
          '--secure-schemes=app,localfile',
          'apps/desktop',
          '/repo/apps',
        ],
        options,
      ),
    ).toEqual({ kind: 'path', newWindow: false, path: '/repo/apps' });
  });

  it('should prefer a resolvable --open-path over positionals', () => {
    expect(parseLaunchArgs(['/x/LobeHub', '--open-path', '/tmp', '/repo'], options)).toMatchObject({
      path: '/tmp',
    });
  });
});

describe('createPathTarget', () => {
  it('should build a target from an open-file directory', () => {
    expect(createPathTarget('/Users/me/Code/app', options)).toEqual({
      kind: 'path',
      newWindow: false,
      path: '/Users/me/Code/app',
    });
  });

  it('should ignore a path that is not a directory', () => {
    expect(createPathTarget('/Users/me/Code/app/README.md', options)).toBeNull();
  });
});
