import { describe, expect, it } from 'vitest';

import { formatFileSearchResults } from './formatFileSearchResults';

describe('formatFileSearchResults', () => {
  it('should format empty results', () => {
    const result = formatFileSearchResults([]);
    expect(result).toMatchInlineSnapshot(`"No files found"`);
  });

  it('should format single result', () => {
    const results = [{ path: '/src/index.ts' }];
    const result = formatFileSearchResults(results);
    expect(result).toMatchInlineSnapshot(`
      "Found 1 file(s):
        /src/index.ts"
    `);
  });

  it('should format multiple results', () => {
    const results = [
      { path: '/src/index.ts' },
      { path: '/src/utils.ts' },
      { path: '/src/types.ts' },
    ];
    const result = formatFileSearchResults(results);
    expect(result).toMatchInlineSnapshot(`
      "Found 3 file(s):
        /src/index.ts
        /src/utils.ts
        /src/types.ts"
    `);
  });
});
