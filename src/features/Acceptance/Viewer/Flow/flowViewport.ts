import type { Rect, Viewport } from '@xyflow/react';

/** Breathing room between a revealed node and the canvas edge. */
const INSET = 24;

export interface CanvasSize {
  height: number;
  width: number;
}

/** Whether any part of a flow-space rect is on screen. */
export const isRectVisible = (rect: Rect, viewport: Viewport, size: CanvasSize) => {
  const left = rect.x * viewport.zoom + viewport.x;
  const top = rect.y * viewport.zoom + viewport.y;
  return (
    left < size.width &&
    top < size.height &&
    left + rect.width * viewport.zoom > 0 &&
    top + rect.height * viewport.zoom > 0
  );
};

/**
 * `buildFlowGraph` marks the picked node inside `data`, not with React Flow's
 * own `selected` flag, so the reveal logic must read it from there.
 */
export const getSelectedFlowNodeId = (nodes: { data: Record<string, unknown>; id: string }[]) =>
  nodes.find((node) => Boolean(node.data.selected))?.id;

export interface FlowViewportApi {
  getNodesBounds: (nodes: string[]) => Rect;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport) => unknown;
}

/**
 * The least shift that brings a span inside the visible extent. A span longer
 * than the extent cannot fit, so its leading edge wins: reading starts there.
 */
const axisShift = (start: number, length: number, extent: number) => {
  if (length >= extent - INSET * 2 || start < INSET) return INSET - start;
  const overflow = start + length - (extent - INSET);
  return overflow > 0 ? -overflow : 0;
};

/**
 * Rescue a node that the narrower canvas pushed off screen entirely, by panning
 * the least possible distance and never by zooming.
 *
 * A node the user can still see, even partly, is left exactly where it is. The
 * canvas moving under a click is far more disorienting than a clipped card:
 * whatever was clicked ends up somewhere else, which reads as it vanishing. The
 * details panel spells the node out anyway, so a clipped edge costs nothing.
 */
export const panNodeIntoView = (
  flow: FlowViewportApi,
  size: CanvasSize,
  id: string | undefined,
) => {
  if (!id) return;
  const bounds = flow.getNodesBounds([id]);
  if (!bounds.width || !bounds.height) return;
  const viewport = flow.getViewport();
  if (isRectVisible(bounds, viewport, size)) return;
  const x =
    viewport.x +
    axisShift(bounds.x * viewport.zoom + viewport.x, bounds.width * viewport.zoom, size.width);
  const y =
    viewport.y +
    axisShift(bounds.y * viewport.zoom + viewport.y, bounds.height * viewport.zoom, size.height);
  if (x === viewport.x && y === viewport.y) return;
  flow.setViewport({ ...viewport, x, y });
};
