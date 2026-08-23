import { describe, expect, it } from 'vitest';

import { cutOutFlatBackground, type RgbaImage, subjectBounds } from './cutOutFlatBackground';

interface Rgb {
  b: number;
  g: number;
  r: number;
}

const ORANGE: Rgb = { b: 40, g: 100, r: 230 };
const SKIN: Rgb = { b: 150, g: 190, r: 240 };
const WHITE: Rgb = { b: 255, g: 255, r: 255 };

/** Paints a flat backdrop with a centered opaque block standing in for the character. */
const makeImage = (
  size: number,
  backdrop: Rgb,
  subject: Rgb,
  subjectInset = Math.floor(size / 4),
): RgbaImage => {
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside =
        x >= subjectInset &&
        x < size - subjectInset &&
        y >= subjectInset &&
        y < size - subjectInset;
      const color = inside ? subject : backdrop;
      const offset = (y * size + x) * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = 255;
    }
  }

  return { data, height: size, width: size };
};

const alphaAt = ({ data, width }: RgbaImage, x: number, y: number) => data[(y * width + x) * 4 + 3];

describe('cutOutFlatBackground', () => {
  it('clears the flat backdrop and keeps the character opaque', () => {
    const image = makeImage(40, ORANGE, SKIN);

    const result = cutOutFlatBackground(image);

    expect(result.applied).toBe(true);
    expect(alphaAt(image, 0, 0)).toBe(0);
    expect(alphaAt(image, 39, 39)).toBe(0);
    expect(alphaAt(image, 20, 20)).toBe(255);
  });

  it('keeps backdrop-colored pixels that are enclosed by the character', () => {
    const image = makeImage(40, WHITE, SKIN);
    // A white highlight inside the subject — same color as the backdrop.
    const offset = (20 * 40 + 20) * 4;
    image.data[offset] = WHITE.r;
    image.data[offset + 1] = WHITE.g;
    image.data[offset + 2] = WHITE.b;

    cutOutFlatBackground(image);

    expect(alphaAt(image, 20, 20)).toBe(255);
    expect(alphaAt(image, 0, 0)).toBe(0);
  });

  it('softens the silhouette instead of leaving a hard key edge', () => {
    const image = makeImage(40, ORANGE, SKIN);
    // An anti-aliased pixel halfway between backdrop and character.
    const offset = (10 * 40 + 20) * 4;
    image.data[offset] = Math.round((ORANGE.r + SKIN.r) / 2);
    image.data[offset + 1] = Math.round((ORANGE.g + SKIN.g) / 2);
    image.data[offset + 2] = Math.round((ORANGE.b + SKIN.b) / 2);

    cutOutFlatBackground(image);

    const alpha = alphaAt(image, 20, 10);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it('reports the character box so callers can crop the margin away', () => {
    const image = makeImage(40, ORANGE, SKIN, 10);

    const { bounds } = cutOutFlatBackground(image);

    expect(bounds).toEqual({ height: 20, left: 10, top: 10, width: 20 });
  });

  it('has no character box when the cut-out was rejected', () => {
    const image = makeImage(40, ORANGE, ORANGE);

    const { applied, bounds } = cutOutFlatBackground(image);

    expect(applied).toBe(false);
    expect(bounds).toBeUndefined();
  });

  it('ignores all-transparent input when measuring the character box', () => {
    const size = 8;
    const data = new Uint8ClampedArray(size * size * 4);

    expect(subjectBounds({ data, height: size, width: size })).toBeUndefined();
  });

  it('reports the cut-out as not applied when the backdrop is not flat', () => {
    const size = 40;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let index = 0; index < size * size; index += 1) {
      const offset = index * 4;
      data[offset] = index % 256;
      data[offset + 1] = (index * 3) % 256;
      data[offset + 2] = (index * 7) % 256;
      data[offset + 3] = 255;
    }

    const result = cutOutFlatBackground({ data, height: size, width: size });

    expect(result.applied).toBe(false);
    expect(data[3]).toBe(255);
  });

  it('reports the cut-out as not applied when it would erase the whole frame', () => {
    const image = makeImage(40, ORANGE, ORANGE);

    const result = cutOutFlatBackground(image);

    expect(result.applied).toBe(false);
    expect(result.removedRatio).toBeGreaterThan(0.97);
  });
});
