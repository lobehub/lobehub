import type { TFunction } from 'i18next';

import type { NormalizedRect, Point } from '../geometry';
import type { AnnotationShape } from './Annotate/shapes';

export const MARKUP_COMMENT_MAX_LENGTH = 1000;

/** A comment pinned to a point, or to a region dragged out on the image. */
export type MarkupAnchor =
  { point: Point; type: 'point' } | { rect: NormalizedRect; type: 'region' };

export interface MarkupComment {
  anchor: MarkupAnchor;
  id: string;
  text: string;
}

/**
 * Marks the user puts on the image before asking about it in chat. They only
 * live in the viewer's memory: closing the viewer drops them.
 */
export interface ImageMarkup {
  comments: MarkupComment[];
  shapes: AnnotationShape[];
}

export const EMPTY_MARKUP: ImageMarkup = { comments: [], shapes: [] };

export const isMarkupEmpty = (markup: ImageMarkup) =>
  markup.comments.length === 0 && markup.shapes.length === 0;

/** Where a pin's number badge sits: the point itself, or a region's top-left corner. */
export const anchorOrigin = (anchor: MarkupAnchor): Point =>
  anchor.type === 'point' ? anchor.point : { x: anchor.rect.x, y: anchor.rect.y };

export const anchorCenter = (anchor: MarkupAnchor): Point =>
  anchor.type === 'point'
    ? anchor.point
    : { x: anchor.rect.x + anchor.rect.width / 2, y: anchor.rect.y + anchor.rect.height / 2 };

export type MarkupArea =
  | 'bottom'
  | 'bottomLeft'
  | 'bottomRight'
  | 'center'
  | 'left'
  | 'right'
  | 'top'
  | 'topLeft'
  | 'topRight';

/** Coarse 3×3 area of the image a point falls in, for a readable location. */
export const describeArea = ({ x, y }: Point): MarkupArea => {
  const col = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
  const row = y < 1 / 3 ? 'top' : y > 2 / 3 ? 'bottom' : 'middle';
  if (row === 'middle') return col;
  if (col === 'center') return row;
  return `${row}${col === 'left' ? 'Left' : 'Right'}` as MarkupArea;
};

const percent = (value: number) => Math.round(value * 100);

type Translate = TFunction<'file'>;

/** `top left (x 12%, y 20%)` or `region top left (x 10–40%, y 5–30%)`. */
export const describeAnchor = (anchor: MarkupAnchor, t: Translate) => {
  const area = t(`imageViewer.markup.area.${describeArea(anchorCenter(anchor))}`);
  if (anchor.type === 'point')
    return t('imageViewer.markup.location.point', {
      area,
      x: percent(anchor.point.x),
      y: percent(anchor.point.y),
    });

  const { height, width, x, y } = anchor.rect;
  return t('imageViewer.markup.location.region', {
    area,
    x1: percent(x),
    x2: percent(x + width),
    y1: percent(y),
    y2: percent(y + height),
  });
};

/**
 * The text that goes into the chat input next to the marked-up image: one
 * numbered line per comment, matching the numbers drawn on the image.
 */
export const buildMarkupMessage = (
  markup: ImageMarkup,
  { name, t }: { name?: string; t: Translate },
) => {
  const hasDrawing = markup.shapes.length > 0;
  const header = t(
    markup.comments.length === 0
      ? 'imageViewer.markup.message.drawingOnly'
      : hasDrawing
        ? 'imageViewer.markup.message.headerWithDrawing'
        : 'imageViewer.markup.message.header',
    { name: name || 'image' },
  );
  const lines = markup.comments.map((comment, index) =>
    t('imageViewer.markup.message.item', {
      index: index + 1,
      location: describeAnchor(comment.anchor, t),
      text: comment.text.trim(),
    }),
  );
  return [header, ...lines].join('\n');
};

type MarkerContext = Pick<
  CanvasRenderingContext2D,
  | 'arc'
  | 'beginPath'
  | 'fill'
  | 'fillStyle'
  | 'fillText'
  | 'font'
  | 'lineWidth'
  | 'setLineDash'
  | 'stroke'
  | 'strokeRect'
  | 'strokeStyle'
  | 'textAlign'
  | 'textBaseline'
>;

export const MARKER_COLOR = '#0a84ff';

/**
 * Draw numbered comment markers in pixel space of a `width × height` canvas,
 * so the exported image carries the same numbers as the message text.
 */
export const drawCommentMarkers = (
  ctx: MarkerContext,
  comments: MarkupComment[],
  width: number,
  height: number,
) => {
  const unit = Math.min(width, height);
  const radius = Math.max(10, unit * 0.022);

  comments.forEach((comment, index) => {
    const { anchor } = comment;
    if (anchor.type === 'region') {
      ctx.strokeStyle = MARKER_COLOR;
      ctx.lineWidth = Math.max(2, unit * 0.004);
      ctx.setLineDash([radius * 0.6, radius * 0.4]);
      ctx.strokeRect(
        anchor.rect.x * width,
        anchor.rect.y * height,
        anchor.rect.width * width,
        anchor.rect.height * height,
      );
      ctx.setLineDash([]);
    }

    const origin = anchorOrigin(anchor);
    const cx = Math.min(Math.max(origin.x * width, radius), width - radius);
    const cy = Math.min(Math.max(origin.y * height, radius), height - radius);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = MARKER_COLOR;
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius * 0.18);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(radius * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), cx, cy);
  });
};
