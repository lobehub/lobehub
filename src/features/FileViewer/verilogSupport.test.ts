import { describe, expect, it } from 'vitest';

import { matchesFileTypeGuard } from './verilogSupport';

/**
 * T-331: the FileViewer must route .v/.sv attachments into the Code renderer
 * instead of the NotSupport view. The routing decision lives in
 * `FileViewer/index.tsx` (CODE_EXTENSIONS); this test mirrors the same
 * matcher (`matchesFileType`) against the production extension list re-export
 * here so a future edit that drops the entries fails loudly.
 */
describe('FileViewer Verilog / SystemVerilog routing (T-331)', () => {
  it('routes by extension regardless of case', () => {
    expect(matchesFileTypeGuard({ fileName: 'adder.v' })).toBe(true);
    expect(matchesFileTypeGuard({ fileName: 'TOP.SV' })).toBe(true);
  });

  it('routes by bare fileType token (stored extension-as-mime)', () => {
    expect(matchesFileTypeGuard({ fileType: 'v' })).toBe(true);
    expect(matchesFileTypeGuard({ fileType: 'sv' })).toBe(true);
  });

  it('does not claim unrelated files', () => {
    expect(matchesFileTypeGuard({ fileName: 'archive.zip' })).toBe(false);
    expect(matchesFileTypeGuard({ fileName: 'photo.heic', fileType: 'image/heic' })).toBe(false);
    expect(matchesFileTypeGuard({ fileName: 'file.vsv' })).toBe(false);
  });
});
