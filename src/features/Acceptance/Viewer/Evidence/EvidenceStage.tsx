'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useEffect, useRef } from 'react';

import type { DraftAnnotation } from './Annotation';
import { AnnotationCanvas } from './Annotation';
import { useMeasuredWidth } from './useMeasuredWidth';

type Rect = AcceptanceReviewAnnotation['rect'];

const styles = createStaticStyles(({ css }) => ({
  /** The zoom stage — its native scrolling doubles as panning. Flex plus the
      inner frame's `margin: auto` keeps the image centered when it fits, and
      scrolls from the edges once it grows past it. */
  viewport: css`
    overflow: auto;
    overscroll-behavior: contain;
    display: flex;
    flex: 1;

    min-width: 0;
    min-height: 120px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  /** `margin: auto` absorbs the free space on both axes (centering) and
      collapses to 0 on overflow. */
  viewportInner: css`
    margin: auto;
  `,
}));

const SWIPE_MIN_PX = 60;
/** A swipe has to be decisively horizontal, or vertical reading steals images. */
const SWIPE_AXIS_RATIO = 1.5;

interface EvidenceStageProps {
  annotations: DraftAnnotation[];
  /** Drags mark regions instead of panning. */
  drawing: boolean;
  onDraw: (rect: Rect) => void;
  onRemove: (index: number) => void;
  /** Step to the previous (-1) or next (1) image. Touch only. */
  onSwipe?: (direction: 1 | -1) => void;
  onUpdate: (index: number, rect: Rect) => void;
  src: string;
  /** Coarse pointer: allow page panning and swipe-to-switch at 1x. */
  touch?: boolean;
  zoom: number;
}

/**
 * The evidence image at a zoom level, with its circled regions on top.
 *
 * It owns the scroll container because the container IS the pan surface and the
 * width the zoom multiplies. Measuring lives here for the same reason: a host
 * that measured a node it does not render ends up observing a detached element
 * the moment the layout swaps (see useMeasuredWidth).
 */
export const EvidenceStage = memo<EvidenceStageProps>(
  ({ annotations, drawing, onDraw, onRemove, onSwipe, onUpdate, src, touch, zoom }) => {
    const { node, ref, width } = useMeasuredWidth<HTMLDivElement>();
    const swipeStart = useRef<{ x: number; y: number } | null>(null);
    const canSwipe = Boolean(touch && onSwipe) && !drawing && zoom === 1;

    // A new image starts at the top-left; carrying the previous pan offset would
    // open the next screenshot scrolled to nowhere in particular.
    useEffect(() => {
      node?.scrollTo(0, 0);
    }, [node, src]);

    return (
      <div
        className={styles.viewport}
        ref={ref}
        style={{ touchAction: canSwipe ? 'pan-y pinch-zoom' : undefined }}
        onTouchEnd={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          const point = event.changedTouches[0];
          if (!start || !point) return;
          const dx = point.clientX - start.x;
          const dy = point.clientY - start.y;
          if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO)
            onSwipe?.(dx < 0 ? 1 : -1);
        }}
        onTouchStart={(event) => {
          const point = event.touches[0];
          swipeStart.current =
            canSwipe && event.touches.length === 1 ? { x: point.clientX, y: point.clientY } : null;
        }}
      >
        <div className={styles.viewportInner}>
          <AnnotationCanvas
            annotations={annotations}
            drawing={drawing}
            // The border eats two pixels the image must not claim back, or the
            // stage gains a scrollbar at exactly 100%.
            imageWidth={width ? Math.max(width * zoom - 2, 0) : undefined}
            src={src}
            onDraw={onDraw}
            onRemove={onRemove}
            onUpdate={onUpdate}
          />
        </div>
      </div>
    );
  },
);

EvidenceStage.displayName = 'AcceptanceEvidenceStage';
