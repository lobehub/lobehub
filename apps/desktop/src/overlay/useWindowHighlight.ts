import type { ScreenCaptureWindowInfo } from '@lobechat/electron-client-ipc';
import { useCallback, useState } from 'react';

function containsPoint(
  windowInfo: ScreenCaptureWindowInfo,
  clientX: number,
  clientY: number,
): boolean {
  const { x, y, width, height } = windowInfo.overlayBounds;
  return clientX >= x && clientX <= x + width && clientY >= y && clientY <= y + height;
}

export function getTopmostWindowAtPoint(
  windows: ScreenCaptureWindowInfo[],
  clientX: number,
  clientY: number,
): ScreenCaptureWindowInfo | null {
  for (const win of windows) {
    if (containsPoint(win, clientX, clientY)) return win;
  }

  return null;
}

export function useWindowHighlight(windows: ScreenCaptureWindowInfo[]) {
  const [hoveredWindow, setHoveredWindow] = useState<ScreenCaptureWindowInfo | null>(null);

  const handleMouseMove = useCallback(
    (clientX: number, clientY: number) => {
      setHoveredWindow(getTopmostWindowAtPoint(windows, clientX, clientY));
    },
    [windows],
  );

  return { handleMouseMove, hoveredWindow };
}
