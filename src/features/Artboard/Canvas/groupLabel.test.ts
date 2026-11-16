import { describe, expect, it } from 'vitest';

import { GROUP_LABEL_HEIGHT, groupLabelRoom, groupLabelScale } from './groupLabel';

const rect = (x: number, y: number, w: number, h: number) => ({ h, w, x, y });

describe('groupLabelRoom', () => {
  it('is the gap up to the nearest frame above that shares columns', () => {
    const room = groupLabelRoom(
      [
        { id: 'top', rect: rect(0, -144, 1200, 672) },
        { id: 'bottom', rect: rect(0, 576, 1200, 672) },
      ],
      [],
    );

    expect(room.bottom).toBe(48);
    expect(room.top).toBe(Infinity);
  });

  it('ignores frames beside it and counts boards outside any group', () => {
    const room = groupLabelRoom(
      [
        { id: 'left', rect: rect(0, 0, 500, 500) },
        { id: 'right', rect: rect(700, 100, 500, 500) },
      ],
      [rect(800, -100, 200, 160)],
    );

    expect(room.left).toBe(Infinity);
    expect(room.right).toBe(40);
  });
});

describe('groupLabelScale', () => {
  it('keeps the on-screen size while the label fits above the frame', () => {
    expect(groupLabelScale(0.5, Infinity)).toBe(2);
    expect(groupLabelScale(1, GROUP_LABEL_HEIGHT)).toBe(1);
  });

  it('shrinks the label to the room above the frame', () => {
    expect(groupLabelScale(0.5, 48)).toBeCloseTo(48 / GROUP_LABEL_HEIGHT);
  });

  it('hides a label that would only fit at an unreadable size', () => {
    expect(groupLabelScale(0.23, 48)).toBeNull();
  });
});
