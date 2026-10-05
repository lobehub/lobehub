import type { NormalizedRect, Point } from '../../geometry';

export type AnnotationTool = 'brush' | 'rect';

interface ShapeStyle {
  color: string;
  /** Stroke width as a fraction of the image's shorter side, so it scales with export size. */
  size: number;
}

export interface BrushShape extends ShapeStyle {
  points: Point[];
  type: 'brush';
}

export interface RectShape extends ShapeStyle {
  rect: NormalizedRect;
  type: 'rect';
}

export type AnnotationShape = BrushShape | RectShape;

export const ANNOTATION_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'] as const;

/** Spoken names for the swatches, keyed by color (locale key suffix). */
export const ANNOTATION_COLOR_NAMES: Record<
  (typeof ANNOTATION_COLORS)[number],
  'blue' | 'green' | 'red' | 'white' | 'yellow'
> = {
  '#0a84ff': 'blue',
  '#34c759': 'green',
  '#ff3b30': 'red',
  '#ffcc00': 'yellow',
  '#ffffff': 'white',
};

export const ANNOTATION_SIZES = {
  large: 0.012,
  medium: 0.006,
  small: 0.003,
} as const;

/** Rectangle spanned by two drag points, whichever corner the drag started from. */
export const rectFromPoints = (a: Point, b: Point): NormalizedRect => ({
  height: Math.abs(b.y - a.y),
  width: Math.abs(b.x - a.x),
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
});

/** Drop accidental clicks that would export as a dot or a zero-size box. */
export const isMeaningfulShape = (shape: AnnotationShape) =>
  shape.type === 'brush'
    ? shape.points.length > 1
    : shape.rect.width > 0.002 && shape.rect.height > 0.002;

type DrawingContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'lineTo'
  | 'moveTo'
  | 'stroke'
  | 'strokeRect'
  | 'lineCap'
  | 'lineJoin'
  | 'lineWidth'
  | 'strokeStyle'
>;

/** Paint shapes in pixel space of a `width × height` canvas. */
export const drawShapes = (
  ctx: DrawingContext,
  shapes: AnnotationShape[],
  width: number,
  height: number,
) => {
  const unit = Math.min(width, height);

  for (const shape of shapes) {
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = Math.max(1, shape.size * unit);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (shape.type === 'rect') {
      const { x, y, width: w, height: h } = shape.rect;
      ctx.strokeRect(x * width, y * height, w * width, h * height);
      continue;
    }

    const [first, ...rest] = shape.points;
    if (!first) continue;
    ctx.beginPath();
    ctx.moveTo(first.x * width, first.y * height);
    for (const point of rest) ctx.lineTo(point.x * width, point.y * height);
    ctx.stroke();
  }
};
