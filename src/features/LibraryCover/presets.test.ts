import { describe, expect, it } from 'vitest';

import {
  defaultCoverPreset,
  LIBRARY_COVER_PRESETS,
  libraryCoverOf,
  presetCoverValue,
  resolveLibraryCover,
} from './presets';

describe('resolveLibraryCover', () => {
  it('renders a chosen preset', () => {
    expect(resolveLibraryCover(presetCoverValue('dusk'), 'kb-1')).toMatchObject({
      kind: 'preset',
      presetId: 'dusk',
    });
  });

  it('renders an uploaded image', () => {
    expect(resolveLibraryCover('https://cdn.test/cover.png', 'kb-1')).toEqual({
      kind: 'image',
      url: 'https://cdn.test/cover.png',
    });
    expect(resolveLibraryCover('/f/file-1', 'kb-1')).toEqual({ kind: 'image', url: '/f/file-1' });
  });

  it.each([undefined, '', 'preset:unknown', 'javascript:alert(1)', 42])(
    'falls back to the default cover for %s',
    (cover) => {
      expect(resolveLibraryCover(cover, 'kb-1')).toMatchObject({
        kind: 'preset',
        presetId: defaultCoverPreset('kb-1').id,
      });
    },
  );
});

describe('defaultCoverPreset', () => {
  it('is stable for a seed and spreads across presets', () => {
    expect(defaultCoverPreset('kb-1')).toBe(defaultCoverPreset('kb-1'));

    const picked = new Set(Array.from({ length: 40 }, (_, i) => defaultCoverPreset(`kb-${i}`).id));
    expect(picked.size).toBeGreaterThan(LIBRARY_COVER_PRESETS.length / 2);
  });
});

describe('libraryCoverOf', () => {
  it('reads the cover from untyped settings', () => {
    expect(libraryCoverOf({ cover: 'preset:sky' })).toBe('preset:sky');
    expect(libraryCoverOf(null)).toBeUndefined();
    expect(libraryCoverOf({ cover: 1 })).toBeUndefined();
  });
});
