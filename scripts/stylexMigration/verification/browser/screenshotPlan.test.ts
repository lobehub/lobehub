import { describe, expect, it } from 'vitest';

import { shouldCaptureScreenshot } from './screenshotPlan';

describe('bounded per-variant screenshot fallback', () => {
  it('does not spend every screenshot on raw class-name differences in the first variant', () => {
    expect(shouldCaptureScreenshot(['first', 'last'], ['first'], 'first', false)).toBe(false);
    expect(shouldCaptureScreenshot(['first', 'last'], ['first'], 'last', false)).toBe(true);
  });

  it('reserves room for later variants even when an early variant has real differences', () => {
    const variants = Array.from({ length: 18 }, (_, index) => String(index));
    const captured = Array.from({ length: 7 }, () => '0');
    expect(shouldCaptureScreenshot(variants, captured, '0', true)).toBe(false);
    for (const variant of variants.slice(1)) {
      expect(shouldCaptureScreenshot(variants, captured, variant, false)).toBe(true);
      captured.push(variant);
    }
    expect(captured).toHaveLength(24);
    expect(shouldCaptureScreenshot(variants, captured, 'new', true)).toBe(false);
  });
});
