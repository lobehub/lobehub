import { OVERLAY_LAYOUT } from './constants';

export interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export type DockSide = 'right' | 'below' | 'left' | 'above' | 'edge';

export interface DockResult {
  left: number;
  side: DockSide;
  top: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function computeDockPosition({
  rect,
  viewportWidth,
  viewportHeight,
  panelWidth,
  panelHeight,
  gap = 16,
}: {
  gap?: number;
  panelHeight: number;
  panelWidth: number;
  rect: Rect;
  viewportHeight: number;
  viewportWidth: number;
}): DockResult {
  const viewportMargin = OVERLAY_LAYOUT.viewportMargin;
  const tryRight = rect.x + rect.width + gap + panelWidth <= viewportWidth;
  const tryBelow = rect.y + rect.height + gap + panelHeight <= viewportHeight;
  const tryLeft = rect.x - gap - panelWidth >= 0;
  const tryAbove = rect.y - gap - panelHeight >= 0;

  const centerX = rect.x + rect.width / 2 - panelWidth / 2;
  const centerY = rect.y + rect.height / 2 - panelHeight / 2;

  if (tryRight) {
    return {
      left: rect.x + rect.width + gap,
      side: 'right',
      top: clamp(centerY, viewportMargin, viewportHeight - panelHeight - viewportMargin),
    };
  }
  if (tryBelow) {
    return {
      left: clamp(centerX, viewportMargin, viewportWidth - panelWidth - viewportMargin),
      side: 'below',
      top: rect.y + rect.height + gap,
    };
  }
  if (tryLeft) {
    return {
      left: rect.x - gap - panelWidth,
      side: 'left',
      top: clamp(centerY, viewportMargin, viewportHeight - panelHeight - viewportMargin),
    };
  }
  if (tryAbove) {
    return {
      left: clamp(centerX, viewportMargin, viewportWidth - panelWidth - viewportMargin),
      side: 'above',
      top: rect.y - gap - panelHeight,
    };
  }
  return {
    left: clamp(
      rect.x + rect.width + gap,
      viewportMargin,
      viewportWidth - panelWidth - viewportMargin,
    ),
    side: 'edge',
    top: clamp(
      rect.y + rect.height - panelHeight,
      viewportMargin,
      viewportHeight - panelHeight - viewportMargin,
    ),
  };
}

export function connectorPoint(rect: Rect, side: DockSide): { x: number; y: number } {
  switch (side) {
    case 'right': {
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
    }
    case 'left': {
      return { x: rect.x, y: rect.y + rect.height / 2 };
    }
    case 'below': {
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
    }
    case 'above': {
      return { x: rect.x + rect.width / 2, y: rect.y };
    }
    default: {
      return { x: rect.x + rect.width, y: rect.y + rect.height };
    }
  }
}
