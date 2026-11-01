import { describe, expect, it } from 'vitest';

import { resolveAspectRatio } from './aspectRatio';

describe('resolveAspectRatio', () => {
  it('falls back to a square when nothing is known yet', () => {
    expect(resolveAspectRatio()).toBe(1);
    expect(resolveAspectRatio({}, null)).toBe(1);
    expect(resolveAspectRatio({ aspectRatio: 'auto', size: 'auto' })).toBe(1);
  });

  it('prefers the final asset dimensions over the requested parameters', () => {
    expect(resolveAspectRatio({ aspectRatio: '1:1' }, { height: 1024, width: 1536 })).toBe(1.5);
  });

  it('reads aspectRatio, size and width/height parameters', () => {
    expect(resolveAspectRatio({ aspectRatio: '16:9' })).toBeCloseTo(16 / 9);
    expect(resolveAspectRatio({ size: '1024x1536' })).toBeCloseTo(1024 / 1536);
    expect(resolveAspectRatio({ height: 768, width: 1024 })).toBeCloseTo(4 / 3);
  });

  it('clamps extreme ratios so the canvas stays usable in the chat flow', () => {
    expect(resolveAspectRatio({ aspectRatio: '10:1' })).toBeCloseTo(21 / 9);
    expect(resolveAspectRatio({ height: 4000, width: 100 })).toBeCloseTo(9 / 21);
  });

  it('ignores an incomplete asset', () => {
    expect(resolveAspectRatio({ aspectRatio: '3:2' }, { width: 1024 })).toBe(1.5);
  });
});
