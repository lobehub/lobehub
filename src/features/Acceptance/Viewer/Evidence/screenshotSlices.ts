import type { AcceptanceReviewAnnotation } from '@lobechat/types';

type Rect = AcceptanceReviewAnnotation['rect'];

export const SCREENSHOT_SLICE_ASPECT = 844 / 390;
export const SCREENSHOT_TILE_MAX_WIDTH = 280;

export interface ScreenshotSlice {
  height: number;
  index: number;
  top: number;
}

export const screenshotSlices = (
  fileWidth?: number | null,
  fileHeight?: number | null,
): ScreenshotSlice[] | undefined => {
  if (!fileWidth || !fileHeight || fileWidth <= 0 || fileHeight <= 0) return;

  const sliceHeight = Math.round(fileWidth * SCREENSHOT_SLICE_ASPECT);
  if (sliceHeight <= 0 || fileHeight < sliceHeight * 2) return;

  const slices: ScreenshotSlice[] = [];
  let top = 0;
  let index = 0;
  while (top < fileHeight) {
    const height = Math.min(sliceHeight, fileHeight - top);
    slices.push({ height, index, top });
    top += height;
    index += 1;
  }
  return slices;
};

export const SCREENSHOT_PORTRAIT_ASPECT = 1.6;

export const screenshotTileWidth = (fileWidth: number) =>
  Math.min(fileWidth, SCREENSHOT_TILE_MAX_WIDTH);

export const isPortraitScreenshot = (fileWidth: number, fileHeight: number) =>
  fileWidth > 0 && fileHeight / fileWidth >= SCREENSHOT_PORTRAIT_ASPECT;

export const screenshotSliceObjectPosition = (slice: ScreenshotSlice, fileHeight: number) => {
  const overflow = fileHeight - slice.height;
  if (overflow <= 0) return '0 0';
  return `0 ${(slice.top / overflow) * 100}%`;
};

export const annotationInSlice = (
  rect: Rect,
  slice: ScreenshotSlice,
  fileHeight: number,
): Rect | undefined => {
  if (fileHeight <= 0 || slice.height <= 0) return;

  const top = rect.y * fileHeight;
  const bottom = (rect.y + rect.height) * fileHeight;
  const sliceBottom = slice.top + slice.height;
  if (bottom <= slice.top || top >= sliceBottom) return;

  const clippedTop = Math.max(top, slice.top);
  const clippedBottom = Math.min(bottom, sliceBottom);
  return {
    height: (clippedBottom - clippedTop) / slice.height,
    width: rect.width,
    x: rect.x,
    y: (clippedTop - slice.top) / slice.height,
  };
};
