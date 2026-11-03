interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Where to center the viewport so a node becomes visible, or nothing when it
 * already is. The zoom never changes: a panel opening beside the map should
 * leave the map where the reader put it, not rescale it.
 */
export const revealCenter = (
  box: Box,
  viewport: Viewport,
  size: { height: number; width: number },
): { x: number; y: number } | undefined => {
  const left = box.x * viewport.zoom + viewport.x;
  const top = box.y * viewport.zoom + viewport.y;
  const right = left + box.width * viewport.zoom;
  const bottom = top + box.height * viewport.zoom;
  if (left >= 0 && top >= 0 && right <= size.width && bottom <= size.height) return;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
