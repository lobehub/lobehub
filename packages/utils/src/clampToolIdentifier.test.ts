import { describe, expect, it } from 'vitest';

import { clampToolIdentifier, MAX_TOOL_IDENTIFIER_LENGTH } from './clampToolIdentifier';

describe('clampToolIdentifier', () => {
  it('passes through short values untouched', () => {
    expect(clampToolIdentifier('lobe-agent')).toBe('lobe-agent');
    expect(clampToolIdentifier('')).toBe('');
  });

  it('passes through null and undefined', () => {
    expect(clampToolIdentifier(null)).toBeNull();
    expect(clampToolIdentifier(undefined)).toBeUndefined();
  });

  it('keeps a value exactly at the limit', () => {
    const value = 'a'.repeat(MAX_TOOL_IDENTIFIER_LENGTH);
    expect(clampToolIdentifier(value)).toBe(value);
  });

  it('truncates oversized values to the limit', () => {
    const value = 'x'.repeat(40_000);
    expect(clampToolIdentifier(value)).toHaveLength(MAX_TOOL_IDENTIFIER_LENGTH);
  });
});
