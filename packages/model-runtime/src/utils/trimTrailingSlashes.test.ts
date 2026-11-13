import { describe, expect, it } from 'vitest';

import { trimTrailingSlashes } from './trimTrailingSlashes';

describe('trimTrailingSlashes', () => {
  it('removes every trailing slash and keeps inner ones', () => {
    expect(trimTrailingSlashes('https://a.test/v1///')).toBe('https://a.test/v1');
    expect(trimTrailingSlashes('https://a.test/v1')).toBe('https://a.test/v1');
    expect(trimTrailingSlashes('///')).toBe('');
  });

  it('handles very long slash runs in linear time', () => {
    const input = `https://a.test${'/'.repeat(100_000)}x${'/'.repeat(100_000)}`;
    expect(trimTrailingSlashes(input)).toBe(`https://a.test${'/'.repeat(100_000)}x`);
  });
});
