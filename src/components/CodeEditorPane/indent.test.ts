import { describe, expect, it } from 'vitest';

import { detectIndentStyle } from './indent';

describe('detectIndentStyle', () => {
  it('detects two-space indentation', () => {
    const content = ['const a = {', '  b: 1,', '  c: {', '    d: 2,', '  },', '};'].join('\n');

    expect(detectIndentStyle(content)).toEqual({ size: 2, useTabs: false });
  });

  it('detects four-space indentation from nested levels', () => {
    const content = [
      'def outer():',
      '    if True:',
      '        for i in range(3):',
      '            print(i)',
      '    return 1',
    ].join('\n');

    expect(detectIndentStyle(content)).toEqual({ size: 4, useTabs: false });
  });

  it('detects tabs', () => {
    const content = ['func main() {', '\tif true {', '\t\tprintln("hi")', '\t}', '}'].join('\n');

    expect(detectIndentStyle(content)).toEqual({ size: 4, useTabs: true });
  });

  it('falls back to two spaces when a file has no indentation', () => {
    expect(detectIndentStyle('one\ntwo\nthree')).toEqual({ size: 2, useTabs: false });
    expect(detectIndentStyle('')).toEqual({ size: 2, useTabs: false });
  });

  it('ignores whitespace-only lines', () => {
    const content = ['a', '   ', '  b', '   ', '  c'].join('\n');

    expect(detectIndentStyle(content)).toEqual({ size: 2, useTabs: false });
  });

  it('ignores the one-space alignment of block-comment continuation lines', () => {
    // The asterisks of a JSDoc block sit one column in. Before this was
    // excluded, four such lines outvoted the file's real two-space steps.
    const content = [
      '/**',
      ' * Resolve the editor grammar for a file.',
      ' * Falls back to plain text.',
      ' */',
      'const MODES = new Set([',
      "  'go',",
      "  'rust',",
      ']);',
      '',
      '/** Another block. */',
      'export const run = () => {',
      '  return MODES;',
      '};',
    ].join('\n');

    expect(detectIndentStyle(content)).toEqual({ size: 2, useTabs: false });
  });

  it('ignores deep continuation alignment', () => {
    const content = [
      'call(',
      '                        aligned,',
      '                        alsoAligned,',
      ')',
    ].join('\n');

    expect(detectIndentStyle(content)).toEqual({ size: 2, useTabs: false });
  });
});
