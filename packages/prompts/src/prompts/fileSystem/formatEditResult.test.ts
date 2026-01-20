import { describe, expect, it } from 'vitest';

import { formatEditResult } from './formatEditResult';

describe('formatEditResult', () => {
  it('should format edit result without line stats', () => {
    const result = formatEditResult({
      filePath: '/src/index.ts',
      replacements: 3,
    });
    expect(result).toMatchInlineSnapshot(
      `"Successfully replaced 3 occurrence(s) in /src/index.ts"`,
    );
  });

  it('should format edit result with lines added', () => {
    const result = formatEditResult({
      filePath: '/src/index.ts',
      linesAdded: 5,
      replacements: 1,
    });
    expect(result).toMatchInlineSnapshot(
      `"Successfully replaced 1 occurrence(s) in /src/index.ts (+5 -0)"`,
    );
  });

  it('should format edit result with lines deleted', () => {
    const result = formatEditResult({
      filePath: '/src/index.ts',
      linesDeleted: 3,
      replacements: 2,
    });
    expect(result).toMatchInlineSnapshot(
      `"Successfully replaced 2 occurrence(s) in /src/index.ts (+0 -3)"`,
    );
  });

  it('should format edit result with both lines added and deleted', () => {
    const result = formatEditResult({
      filePath: '/src/utils.ts',
      linesAdded: 10,
      linesDeleted: 5,
      replacements: 4,
    });
    expect(result).toMatchInlineSnapshot(
      `"Successfully replaced 4 occurrence(s) in /src/utils.ts (+10 -5)"`,
    );
  });

  it('should handle zero replacements', () => {
    const result = formatEditResult({
      filePath: '/test.txt',
      replacements: 0,
    });
    expect(result).toMatchInlineSnapshot(`"Successfully replaced 0 occurrence(s) in /test.txt"`);
  });
});
