import { describe, expect, it } from 'vitest';

import { formatGlobResults } from './formatGlobResults';

describe('formatGlobResults', () => {
  it('should format empty results', () => {
    const result = formatGlobResults({
      files: [],
      totalFiles: 0,
    });
    expect(result).toMatchInlineSnapshot(`"Found 0 files"`);
  });

  it('should format single file', () => {
    const result = formatGlobResults({
      files: ['/src/index.ts'],
      totalFiles: 1,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 1 files:
        /src/index.ts"
    `);
  });

  it('should format multiple files', () => {
    const result = formatGlobResults({
      files: ['/src/index.ts', '/src/utils.ts', '/src/types.ts'],
      totalFiles: 3,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 3 files:
        /src/index.ts
        /src/utils.ts
        /src/types.ts"
    `);
  });

  it('should truncate files exceeding maxDisplay (default 50)', () => {
    const files = Array.from({ length: 55 }, (_, i) => `/file${i + 1}.ts`);
    const result = formatGlobResults({
      files,
      totalFiles: 55,
    });
    expect(result).toContain('Found 55 files:');
    expect(result).toContain('... and 5 more');
    expect(result).not.toContain('file51');
  });

  it('should respect custom maxDisplay', () => {
    const files = ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts'];
    const result = formatGlobResults({
      files,
      maxDisplay: 3,
      totalFiles: 5,
    });
    expect(result).toMatchInlineSnapshot(`
      "Found 5 files:
        /a.ts
        /b.ts
        /c.ts
        ... and 2 more"
    `);
  });
});
