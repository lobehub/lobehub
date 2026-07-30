import { describe, expect, it } from 'vitest';

import { isUncPath, isWithinWorkingDirectory, resolveEntryPath } from './useOpenEditedFile';

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
});
