import { describe, expect, it } from 'vitest';

import { headerChrome } from './headerChrome';

const noop = () => {};

describe('headerChrome', () => {
  // The board covers the window from its top-left corner, under the macOS traffic lights.
  it('clears the traffic lights and returns to the panel when the board covers the window', () => {
    expect(headerChrome({ onExitFullscreen: noop })).toEqual({
      coversWindow: true,
      exit: 'exitFullscreen',
    });
  });

  // The Works modal is inset from the window, so the lights never overlap it.
  it('just closes the Works modal, without clearing the traffic lights', () => {
    expect(headerChrome({ onClose: noop })).toEqual({ coversWindow: false, exit: 'close' });
  });

  it('offers to cover the window from the side panel', () => {
    expect(headerChrome({})).toEqual({ coversWindow: false, exit: 'enterFullscreen' });
  });
});
