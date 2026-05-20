import type { ScreenCaptureWindowInfo } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { getTopmostWindowAtPoint } from './useWindowHighlight';

const createWindow = (overrides: Partial<ScreenCaptureWindowInfo>): ScreenCaptureWindowInfo => ({
  appName: 'Test App',
  bounds: { height: 300, width: 400, x: 1000, y: 200 },
  order: 0,
  overlayBounds: { height: 300, width: 400, x: 0, y: 0 },
  title: 'Window',
  windowId: 1,
  ...overrides,
});

describe('getTopmostWindowAtPoint', () => {
  it('uses overlay-local coordinates instead of global display coordinates', () => {
    const target = createWindow({
      bounds: { height: 300, width: 400, x: 1440, y: 120 },
      overlayBounds: { height: 300, width: 400, x: 0, y: 0 },
    });

    expect(getTopmostWindowAtPoint([target], 40, 40)).toBe(target);
    expect(getTopmostWindowAtPoint([target], 1480, 160)).toBeNull();
  });

  it('returns the topmost overlapping window first', () => {
    const backWindow = createWindow({
      order: 1,
      overlayBounds: { height: 240, width: 320, x: 10, y: 10 },
      title: 'Back',
      windowId: 2,
    });
    const frontWindow = createWindow({
      order: 0,
      overlayBounds: { height: 200, width: 280, x: 40, y: 40 },
      title: 'Front',
      windowId: 3,
    });

    expect(getTopmostWindowAtPoint([frontWindow, backWindow], 60, 60)).toBe(frontWindow);
  });
});
