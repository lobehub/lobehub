import { describe, expect, it } from 'vitest';

import { resolveEntryPath } from './useOpenEditedFile';

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

  it('does not re-anchor home or UNC paths', () => {
    expect(resolveEntryPath('~/report.md', '/repo')).toBe('~/report.md');
    expect(resolveEntryPath('\\\\server\\share\\report.md', '/repo')).toBe(
      '\\\\server\\share\\report.md',
    );
  });
});
