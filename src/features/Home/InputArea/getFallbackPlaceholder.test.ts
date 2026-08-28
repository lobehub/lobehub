import { describe, expect, it } from 'vitest';

import { getFallbackPlaceholder } from './getFallbackPlaceholder';

describe('getFallbackPlaceholder', () => {
  it('preserves text placeholders accepted by a native textarea', () => {
    expect(getFallbackPlaceholder('Ask anything')).toBe('Ask anything');
  });

  it('omits rich placeholders that only the hydrated editor can render', () => {
    expect(getFallbackPlaceholder(42)).toBeUndefined();
  });
});
