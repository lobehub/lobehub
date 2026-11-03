import { describe, expect, it } from 'vitest';

import { parseDataUri } from './uriParser';

describe('parseDataUri', () => {
  it('should parse a valid data URI', () => {
    const dataUri = 'data:image/png;base64,abc';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: 'abc', mimeType: 'image/png', type: 'base64' });
  });

  it('should parse a valid URL', () => {
    const url = 'https://example.com/image.jpg';
    const result = parseDataUri(url);
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should return null for an invalid input', () => {
    const invalidInput = 'invalid-data';
    const result = parseDataUri(invalidInput);
    expect(result).toEqual({ base64: null, mimeType: null, type: null });
  });

  it('should handle an empty input', () => {
    const emptyInput = '';
    const result = parseDataUri(emptyInput);
    expect(result).toEqual({ base64: null, mimeType: null, type: null });
  });

  it('should handle data URI with additional parameters before base64 marker', () => {
    const dataUri = 'data:image/png;charset=utf-8;base64,abc123';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({
      base64: 'abc123',
      mimeType: 'image/png;charset=utf-8',
      type: 'base64',
    });
  });

  it('should handle data URI without MIME type', () => {
    const dataUri = 'data:;base64,abc';
    const result = parseDataUri(dataUri);
    // No MIME type between "data:" and ";base64," should fail
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should handle data URI with empty base64 content', () => {
    const dataUri = 'data:image/png;base64,';
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: null, mimeType: null, type: 'url' });
  });

  it('should handle large data URIs without stack overflow', () => {
    // Simulate a ~26MB data URI similar to what Nano Banana 2 generates
    const largePadding = 'A'.repeat(1_000_000);
    const dataUri = `data:image/png;base64,${largePadding}`;
    const result = parseDataUri(dataUri);
    expect(result).toEqual({ base64: largePadding, mimeType: 'image/png', type: 'base64' });
  });
});
