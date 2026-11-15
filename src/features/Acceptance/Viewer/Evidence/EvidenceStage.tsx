'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MoveHorizontal, MoveVertical } from 'lucide-react';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { DraftAnnotation } from './Annotation';
import { AnnotationCanvas } from './Annotation';
import { resolveStageFit, stageContentBox, type StageSize } from './stageFit';
import { useMeasuredWidth } from './useMeasuredWidth';
import { usePinchZoom } from './usePinchZoom';

type Rect = AcceptanceReviewAnnotation['rect'];

// One pixel more than the CSS padding on every side: the canvas frame draws a
// border around the image, and the fit must leave room for it.
const CONTAINED_PADDING = { bottom: 17, left: 17, right: 17, top: 17 };
const CONTROLS_PADDING = { ...CONTAINED_PADDING, bottom: 69 };

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'flex',
    flex: '1',
    alignSelf: 'stretch',
    minWidth: '0',
    minHeight: '120px',
  },
  viewport: {
    overflow: 'auto',
    overscrollBehavior: 'contain',
    display: 'flex',
    flex: '1',
    minWidth: '0',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  contained: {
    padding: '16px',
    borderRadius: '12px',
  },
  containedControls: {
    paddingBlockEnd: '68px',
  },
  // A flex box, not a block: the inline-block canvas frame would otherwise sit
  // on a text baseline and add a few pixels under an image fitted to the height.
  viewportInner: { display: 'flex', flex: 'none', margin: 'auto' },
  toggle: {
    position: 'absolute',
    zIndex: 5,
    insetBlockEnd: '12px',
    insetInlineEnd: '12px',
  },
});

const SWIPE_MIN_PX = 60;
/** A swipe has to be decisively horizontal, or vertical reading steals images. */
const SWIPE_AXIS_RATIO = 1.5;

// With our own pinch the browser must not zoom the page on two fingers;
// without it, leave the native gesture alone.
const stageTouchAction = (ownPinch: boolean, canSwipe: boolean) => {
  if (ownPinch) return canSwipe ? 'pan-y' : 'pan-x pan-y';
  return canSwipe ? 'pan-y pinch-zoom' : undefined;
};

interface EvidenceStageProps {
  annotations: DraftAnnotation[];
  // Off, the image takes the stage width and the stage scrolls: the phone
  // review has no layout-given height to fit into and relies on that.
  contain?: boolean;
  controls?: ReactNode;
  /** Drags mark regions instead of panning. */
  drawing: boolean;
  onDraw: (rect: Rect) => void;
  onRemove: (index: number) => void;
  /** Step to the previous (-1) or next (1) image. Touch only. */
  onSwipe?: (direction: 1 | -1) => void;
  onUpdate: (index: number, rect: Rect) => void;
  /** Two-finger zoom. Touch only; absent on the desktop stage. */
  onZoom?: (zoom: number) => void;
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
  ({
    annotations,
    contain,
    controls,
    drawing,
    onDraw,
    onRemove,
    onSwipe,
    onUpdate,
    onZoom,
    src,
    touch,
    zoom,
  }) => {
    const { t } = useTranslation('verify');
    const { height, node, ref, width } = useMeasuredWidth<HTMLDivElement>();
    const pinch = usePinchZoom({ node, onZoom: touch ? onZoom : undefined, zoom });
    const swipeStart = useRef<{ x: number; y: number } | null>(null);
    const canSwipe = Boolean(touch && onSwipe) && !drawing && zoom === 1;
    const [loaded, setLoaded] = useState<StageSize & { src: string }>();
    const [fitHeightSrc, setFitHeightSrc] = useState<string>();
    const fitHeight = fitHeightSrc === src;

    const fit = contain
      ? resolveStageFit({
          fitHeight,
          natural: loaded?.src === src ? loaded : undefined,
          stage: stageContentBox(
            { height, width },
            controls ? CONTROLS_PADDING : CONTAINED_PADDING,
          ),
        })
      : undefined;

    // The border eats two pixels the image must not claim back, or the
    // stage gains a scrollbar at exactly 100%.
    const fullWidth = width ? Math.max(width * zoom - 2, 0) : undefined;
    const imageWidth = contain ? (fit ? fit.width * zoom : undefined) : fullWidth;

    // A new image starts at the top-left; carrying the previous pan offset would
    // open the next screenshot scrolled to nowhere in particular.
    useEffect(() => {
      node?.scrollTo(0, 0);
    }, [node, src, fitHeight]);

    return (
      <div {...stylex.props(styles.root)}>
        <div
          ref={ref}
          {...sx(
            styles.viewport,
            contain && styles.contained,
            contain && Boolean(controls) && styles.containedControls,
            { touchAction: stageTouchAction(Boolean(onZoom), canSwipe) },
          )}
          onTouchCancel={pinch.handlers.onTouchCancel}
          onTouchMove={pinch.handlers.onTouchMove}
          onTouchEnd={(event) => {
            pinch.handlers.onTouchEnd?.(event);
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
            pinch.handlers.onTouchStart?.(event);
            const point = event.touches[0];
            swipeStart.current =
              canSwipe && event.touches.length === 1
                ? { x: point.clientX, y: point.clientY }
                : null;
          }}
        >
          <div {...stylex.props(styles.viewportInner)}>
            <AnnotationCanvas
              annotations={annotations}
              drawing={drawing}
              imageWidth={imageWidth}
              src={src}
              onDraw={onDraw}
              onRemove={onRemove}
              onUpdate={onUpdate}
              onLoad={(event) =>
                setLoaded({
                  height: event.currentTarget.naturalHeight,
                  src,
                  width: event.currentTarget.naturalWidth,
                })
              }
            />
          </div>
        </div>
        {controls}
        {fit?.tall && (
          <Button
            icon={<Icon icon={fitHeight ? MoveHorizontal : MoveVertical} />}
            size={'small'}
            {...stylex.props(styles.toggle)}
            onClick={() => setFitHeightSrc(fitHeight ? undefined : src)}
          >
            {t(fitHeight ? 'acceptance.stage.fitWidth' : 'acceptance.stage.fitHeight')}
          </Button>
        )}
      </div>
    );
  },
);

EvidenceStage.displayName = 'AcceptanceEvidenceStage';
