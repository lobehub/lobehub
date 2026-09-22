import { describe, expect, it } from 'vitest';

import { joinFontStack, parseFontStack } from './fontStack';

describe('parseFontStack', () => {
  it('returns an empty stack for empty or whitespace input', () => {
    expect(parseFontStack(undefined)).toEqual([]);
    expect(parseFontStack('  ')).toEqual([]);
  });

  it('splits on commas and keeps quoted names intact', () => {
    expect(parseFontStack('Inter, "LXGW WenKai" , Menlo')).toEqual([
      'Inter',
      '"LXGW WenKai"',
      'Menlo',
    ]);
  });

  it('drops empty segments and duplicates', () => {
    expect(parseFontStack('Inter,,Inter, Georgia')).toEqual(['Inter', 'Georgia']);
  });
});

describe('joinFontStack', () => {
  it('round-trips with parseFontStack', () => {
    const stack = ['Inter', '"LXGW WenKai"'];
    expect(parseFontStack(joinFontStack(stack))).toEqual(stack);
  });

  it('returns an empty string for an empty stack', () => {
    expect(joinFontStack([])).toBe('');
  });
});
