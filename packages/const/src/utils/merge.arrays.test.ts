import { describe, expect, it } from 'vitest';

import { mergeArrayById } from './merge';

describe('model metadata array overrides', () => {
  it('keeps nonempty overrides as arrays instead of numeric-key objects', () => {
    const defaults = [{ id: 'model', resolutions: ['512', '1024'], config: { enabled: true } }];
    const overrides = [{ id: 'model', resolutions: ['2048'] }];

    expect(mergeArrayById(defaults, overrides)).toEqual([
      { id: 'model', resolutions: ['2048'], config: { enabled: true } },
    ]);
    expect(defaults[0].resolutions).toEqual(['512', '1024']);
  });

  it('does not convert a newly introduced array to an object', () => {
    expect(mergeArrayById([{ id: 'model' }], [{ id: 'model', sizes: [256, 512] }])).toEqual([
      { id: 'model', sizes: [256, 512] },
    ]);
  });

  it('preserves the existing fallback for empty overrides', () => {
    expect(mergeArrayById([{ id: 'model', sizes: [256] }], [{ id: 'model', sizes: [] }])).toEqual([
      { id: 'model', sizes: [256] },
    ]);
  });
});
