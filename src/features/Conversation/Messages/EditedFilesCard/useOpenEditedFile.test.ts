import { describe, expect, it } from 'vitest';

import {
  canPreviewEditedFile,
  isUncPath,
  isWithinWorkingDirectory,
  planFilesystemOpen,
  resolveEntryPath,
} from './useOpenEditedFile';

describe('resolveEntryPath', () => {
  it('anchors relative paths to the working directory', () => {
    expect(resolveEntryPath('deck.pptx', '/repo')).toBe('/repo/deck.pptx');
    expect(resolveEntryPath('out/report.md', '/repo/')).toBe('/repo/out/report.md');
  });

  it('keeps POSIX and drive-letter absolute paths untouched', () => {
    expect(resolveEntryPath('/tmp/report.md', '/repo')).toBe('/tmp/report.md');
    expect(resolveEntryPath('C:\\work\\report.md', '/repo')).toBe('C:\\work\\report.md');
    expect(resolveEntryPath('c:/work/report.md', '/repo')).toBe('c:/work/report.md');
  });

  // Regression: Windows drive-rooted paths (single leading backslash) are
  // absolute per Node's win32 `path.isAbsolute` — anchoring one would produce
  // `C:\repo/\Users\alice\report.md`.
  it('keeps Windows drive-rooted single-backslash paths untouched', () => {
    expect(resolveEntryPath('\\Users\\alice\\report.md', 'C:\\repo')).toBe(
      '\\Users\\alice\\report.md',
    );
    expect(isUncPath('\\Users\\alice\\report.md')).toBe(false);
  });

  it('flags UNC paths so the local desktop leg keeps them diff-only', () => {
    expect(isUncPath('\\\\server\\share\\report.md')).toBe(true);
    expect(isUncPath('C:\\work\\report.md')).toBe(false);
    expect(isUncPath('/tmp/report.md')).toBe(false);
  });

  it('flags relative entries resolved inside a UNC workspace as UNC', () => {
    expect(isUncPath(resolveEntryPath('deck.pptx', '\\\\server\\share\\repo'))).toBe(true);
  });

  it('does not re-anchor home or UNC paths', () => {
    expect(resolveEntryPath('~/report.md', '/repo')).toBe('~/report.md');
    expect(resolveEntryPath('~', '/repo')).toBe('~');
    expect(resolveEntryPath('~\\report.md', '/repo')).toBe('~\\report.md');
    expect(resolveEntryPath('\\\\server\\share\\report.md', '/repo')).toBe(
      '\\\\server\\share\\report.md',
    );
  });

  // Regression: the file tools expand exactly `~`, `~/`, and `~\` — a first
  // segment merely starting with `~` is a valid cwd-relative path and skipping
  // the anchor would resolve it under the preview host's own cwd instead.
  it('anchors paths whose first segment merely starts with ~', () => {
    expect(resolveEntryPath('~backup/report.md', '/repo')).toBe('/repo/~backup/report.md');
  });

  // Regression: Windows accepts forward-slash UNC roots too, and they hit the
  // same localfile:// codec that collapses the leading double separator.
  it('flags forward-slash UNC paths so the local desktop leg keeps them diff-only', () => {
    expect(isUncPath('//server/share/report.md')).toBe(true);
    expect(isUncPath(resolveEntryPath('deck.pptx', '//server/share/repo'))).toBe(true);
    expect(isUncPath('/tmp/report.md')).toBe(false);
  });
});

describe('isWithinWorkingDirectory', () => {
  it('contains the root itself and nested paths', () => {
    expect(isWithinWorkingDirectory('/repo', '/repo')).toBe(true);
    expect(isWithinWorkingDirectory('/repo/out/report.md', '/repo')).toBe(true);
    expect(isWithinWorkingDirectory('/repo/out/report.md', '/repo/')).toBe(true);
  });

  // Regression: an outside-cwd absolute path (e.g. an approved /tmp write) has
  // no implicit preview permission — it needs the external allowance on the
  // desktop leg and stays diff-only on the device leg.
  it('rejects outside-cwd paths without prefix-collision false positives', () => {
    expect(isWithinWorkingDirectory('/tmp/report.md', '/repo')).toBe(false);
    expect(isWithinWorkingDirectory('/repo-archive/report.md', '/repo')).toBe(false);
  });

  it('normalizes separators across Windows and POSIX forms', () => {
    expect(isWithinWorkingDirectory('C:\\work\\report.md', 'C:/work')).toBe(true);
    expect(isWithinWorkingDirectory('C:/other/report.md', 'C:\\work')).toBe(false);
  });

  // Regression: Windows filesystems (drive-letter and UNC) are
  // case-insensitive — `c:\repo\out.md` lives inside `C:\Repo`. POSIX paths
  // must keep case sensitivity: /Repo and /repo are different directories.
  it('compares Windows-style paths case-insensitively but POSIX case-sensitively', () => {
    expect(isWithinWorkingDirectory('c:\\repo\\out.md', 'C:\\Repo')).toBe(true);
    expect(isWithinWorkingDirectory('//SERVER/Share/x.md', '//server/share')).toBe(true);
    expect(isWithinWorkingDirectory('/Repo/out.md', '/repo')).toBe(false);
  });

  // Regression: `..` segments must resolve before containment — a shell write
  // of `../report.md` from /repo/sub lexically prefix-matches /repo/sub but
  // actually lands outside it, and both preview hosts would reject the open.
  it('resolves dot segments before comparing', () => {
    expect(isWithinWorkingDirectory('/repo/sub/../report.md', '/repo/sub')).toBe(false);
    expect(isWithinWorkingDirectory('/repo/sub/../report.md', '/repo')).toBe(true);
    expect(isWithinWorkingDirectory('/repo/./out/report.md', '/repo')).toBe(true);
    expect(isWithinWorkingDirectory('/repo/../../etc/passwd', '/repo')).toBe(false);
    expect(isWithinWorkingDirectory('//server/share/sub/../x.md', '//server/share')).toBe(true);
  });
});

describe('canPreviewEditedFile', () => {
  // Regression: a deleted file no longer exists on any transport — opening the
  // portal would render a load error, so the deletion diff stays primary.
  it('keeps deleted entries diff-only but previews every other kind', () => {
    expect(canPreviewEditedFile({ kind: 'deleted' })).toBe(false);
    expect(canPreviewEditedFile({ kind: 'added' })).toBe(true);
    expect(canPreviewEditedFile({ kind: 'modified' })).toBe(true);
    expect(canPreviewEditedFile({ kind: 'renamed' })).toBe(true);
  });
});

describe('planFilesystemOpen', () => {
  it('opens within-cwd paths plainly on both legs', () => {
    expect(
      planFilesystemOpen({
        isDeviceMode: false,
        resolvedPath: '/repo/report.md',
        workingDirectory: '/repo',
      }),
    ).toEqual({});
    expect(
      planFilesystemOpen({
        isDeviceMode: true,
        resolvedPath: '/repo/report.md',
        workingDirectory: '/repo',
      }),
    ).toEqual({});
  });

  it('handles outside-cwd paths per leg: desktop allowance, device diff-only', () => {
    expect(
      planFilesystemOpen({
        isDeviceMode: false,
        resolvedPath: '/tmp/report.md',
        workingDirectory: '/repo',
      }),
    ).toEqual({ allowExternalFilePreview: true });
    expect(
      planFilesystemOpen({
        isDeviceMode: true,
        resolvedPath: '/tmp/report.md',
        workingDirectory: '/repo',
      }),
    ).toBeUndefined();
  });

  // Regression: the literal `~` never containment-matches an absolute cwd, but
  // the preview hosts expand it themselves — the device daemon must get the
  // open (it enforces its own boundary) instead of an inert row.
  it('defers home-anchored paths to the preview hosts', () => {
    expect(
      planFilesystemOpen({
        isDeviceMode: true,
        resolvedPath: '~/project/report.md',
        workingDirectory: '/home/alice/project',
      }),
    ).toEqual({});
    expect(
      planFilesystemOpen({
        isDeviceMode: false,
        resolvedPath: '~/project/report.md',
        workingDirectory: '/Users/alice/project',
      }),
    ).toEqual({ allowExternalFilePreview: true });
  });

  it('keeps UNC paths diff-only on the local desktop but serves them via a device', () => {
    expect(
      planFilesystemOpen({
        isDeviceMode: false,
        resolvedPath: '\\\\server\\share\\report.md',
        workingDirectory: '\\\\server\\share',
      }),
    ).toBeUndefined();
    expect(
      planFilesystemOpen({
        isDeviceMode: true,
        resolvedPath: '\\\\server\\share\\report.md',
        workingDirectory: '\\\\server\\share',
      }),
    ).toEqual({});
  });
});
