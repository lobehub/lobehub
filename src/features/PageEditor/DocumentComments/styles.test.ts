import { describe, expect, it } from 'vitest';

import { RESIZED_IMAGE_SELECTOR } from './styles';

const matches = (style: string) => {
  const img = document.createElement('img');
  img.setAttribute('style', style);
  return img.matches(RESIZED_IMAGE_SELECTOR);
};

describe('RESIZED_IMAGE_SELECTOR', () => {
  it('matches a resized image whose width follows max-width (editor markup)', () => {
    expect(matches('max-width: calc(min(320px, 100%)); width: 320px;')).toBe(true);
  });

  it('matches a resized image whose width is the first declaration (renderer without maxWidth)', () => {
    expect(matches('width: 320px;')).toBe(true);
    expect(matches('width: 320px; height: 200px;')).toBe(true);
  });

  it('does not match an untouched image carrying width: inherit', () => {
    expect(matches('max-width: 500px; width: inherit;')).toBe(false);
    expect(matches('width: inherit;')).toBe(false);
  });

  it('does not treat max-width alone as a resize', () => {
    expect(matches('max-width: 500px;')).toBe(false);
    expect(matches('')).toBe(false);
  });
});
