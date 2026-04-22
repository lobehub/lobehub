import { describe, expect, it } from 'vitest';

import { resolvePanelPlacement } from './panelPlacement';

describe('resolvePanelPlacement', () => {
  it('keeps the last selection placement while a reselection is in progress', () => {
    expect(
      resolvePanelPlacement({
        dockedPlacement: null,
        initialPlacement: { left: 480, top: 720, width: 420 },
        lastSelectionPlacement: { left: 812, top: 168, width: 360 },
      }),
    ).toEqual({
      left: 812,
      top: 168,
      width: 360,
    });
  });

  it('falls back to the initial placement after the remembered position is cleared', () => {
    expect(
      resolvePanelPlacement({
        dockedPlacement: null,
        initialPlacement: { left: 480, top: 720, width: 420 },
        lastSelectionPlacement: null,
      }),
    ).toEqual({
      left: 480,
      top: 720,
      width: 420,
    });
  });
});
