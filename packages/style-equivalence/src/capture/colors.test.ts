import { describe, expect, it } from 'vitest';

import { sameStyleValue } from './colors';

describe('computed color values serialized two ways', () => {
  it('treats color(srgb …) and rgba(…) of the same color as equal', () => {
    expect(sameStyleValue('color(srgb 0.1 0.2 0.3 / 0.5)', 'rgba(26, 51, 77, 0.5)')).toBe(true);
    expect(sameStyleValue('color(srgb 1 1 1)', 'rgb(255, 255, 255)')).toBe(true);
    expect(
      sameStyleValue('0px 1px 2px color(srgb 0 0 0 / 0.06)', '0px 1px 2px rgba(0, 0, 0, 0.06)'),
    ).toBe(true);
  });

  it('still tells different colors and different surroundings apart', () => {
    expect(sameStyleValue('color(srgb 0.1 0.2 0.3 / 0.5)', 'rgba(26, 51, 77, 0.6)')).toBe(false);
    expect(sameStyleValue('color(srgb 0.1 0.2 0.3)', 'rgb(30, 51, 77)')).toBe(false);
    expect(
      sameStyleValue('0px 1px 2px rgba(0, 0, 0, 0.06)', '0px 2px 2px rgba(0, 0, 0, 0.06)'),
    ).toBe(false);
    expect(sameStyleValue('12px', '13px')).toBe(false);
  });
});
