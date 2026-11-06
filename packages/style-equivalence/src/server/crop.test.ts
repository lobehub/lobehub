import { describe, expect, it } from 'vitest';

import { cropClip } from './inspectCase';

describe('cropClip', () => {
  const page = { height: 900, width: 1280 };
  const section = { x: 100, y: 50 };

  it('pads the target box', () => {
    expect(cropClip(page, section, [100, 20, 20, 10], 16)).toEqual({
      height: 42,
      width: 52,
      x: 184,
      y: 54,
    });
  });

  it('keeps a target that overflows its section whole', () => {
    expect(cropClip(page, section, [0, -40, 360, 56], 16)).toEqual({
      height: 82,
      width: 392,
      x: 84,
      y: 0,
    });
  });

  it('never reaches outside the page', () => {
    expect(cropClip(page, { x: 0, y: 0 }, [0, 0, 7, 7], 16)).toEqual({
      height: 23,
      width: 23,
      x: 0,
      y: 0,
    });
    expect(cropClip(page, section, [1170, 840, 10, 10], 16)).toEqual({
      height: 26,
      width: 26,
      x: 1254,
      y: 874,
    });
  });
});
