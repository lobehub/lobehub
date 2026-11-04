import { describe, expect, it } from 'vitest';

import { cropClip } from './inspectCase';

describe('cropClip', () => {
  const section = { height: 60, width: 400, x: 100, y: 50 };

  it('pads the target box', () => {
    expect(cropClip(section, [100, 20, 20, 10], 16)).toEqual({
      height: 42,
      width: 52,
      x: 184,
      y: 54,
    });
  });

  it('never reaches outside the section', () => {
    expect(cropClip(section, [0, 0, 7, 7], 16)).toEqual({ height: 23, width: 23, x: 100, y: 50 });
    expect(cropClip(section, [390, 50, 10, 10], 16)).toEqual({
      height: 26,
      width: 26,
      x: 474,
      y: 84,
    });
  });
});
