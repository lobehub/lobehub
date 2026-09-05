import { describe, expect, it } from 'vitest';

import { getLanguageFromFilename } from './fileLanguage';

describe('getLanguageFromFilename — Hardware Description Languages (T-331)', () => {
  it('maps .v to verilog', () => {
    expect(getLanguageFromFilename('adder.v')).toBe('verilog');
    expect(getLanguageFromFilename('ADDer.V')).toBe('verilog');
  });

  it('maps .sv to the shiki grammar id system-verilog', () => {
    // shiki's bundled grammar id is `system-verilog` — `systemverilog` is not
    // a bundled id/alias and would silently degrade highlighting to plaintext.
    expect(getLanguageFromFilename('top.sv')).toBe('system-verilog');
    expect(getLanguageFromFilename('TOP.SV')).toBe('system-verilog');
  });

  it('does not mis-map lookalike extensions', () => {
    // .vsv / .vv are not Verilog — fall back to txt
    expect(getLanguageFromFilename('file.vsv')).toBe('txt');
    expect(getLanguageFromFilename('file.vv')).toBe('txt');
    expect(getLanguageFromFilename('noext')).toBe('txt');
  });
});
