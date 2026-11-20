import { describe, expect, it } from 'vitest';

import { normalizeCodeText } from './codeText';

describe('normalizeCodeText', () => {
  it('drops the blank lines and the indentation the surrounding HTML adds', () => {
    const text = '\n      if (ok) {\n        run();\n      }\n    ';

    expect(normalizeCodeText(text)).toBe('if (ok) {\n  run();\n}');
  });

  it('keeps code that starts at the first column as written', () => {
    expect(normalizeCodeText('select 1;\n  -- note')).toBe('select 1;\n  -- note');
  });

  it('ignores blank lines when measuring the common indentation', () => {
    expect(normalizeCodeText('    a\n\n    b')).toBe('a\n\nb');
  });
});
