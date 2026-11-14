'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';

import { sx } from '@/styles/sx';

import type { EvidenceOverlay } from './overlay';
import { useAnnotationGesture } from './useAnnotationGesture';

/**
 * Region-comment primitives for acceptance evidence images. Rects are stored
 * normalized (0–1) against the IMAGE box — never the surrounding frame. A
 * frame can silently grow wider than the image it holds (flex stretch, long
 * sibling text driving fit-content), and any rect normalized or rendered
 * against that bigger box lands visibly off the pixels the user circled.
 */

type Rect = AcceptanceReviewAnnotation['rect'];

const coarse = '@media (pointer: coarse)';

const styles = stylex.create({
  badge: {
    position: 'absolute',
    insetBlockStart: '-9px',
    insetInlineStart: '-9px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: 600,
    lineHeight: 1,
    color: cssVar.colorTextLightSolid,
    backgroundColor: cssVar.colorError,
  },
  // Delete mirrors the index badge on the opposite corner — the same pink
  // disc, so which region the action removes reads at a glance. Touch keeps
  // it: a phone reviewer who mis-drags a box has no keyboard escape, and the
  // only other way out used to be leaving the image entirely.
  badgeDelete: {
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: { default: '-9px', [coarse]: '-12px' },
    insetInlineEnd: { default: '-9px', [coarse]: '-12px' },
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: { default: '18px', [coarse]: '24px' },
    height: { default: '18px', [coarse]: '24px' },
    borderStyle: 'none',
    borderRadius: '50%',
    color: cssVar.colorTextLightSolid,
    backgroundColor: cssVar.colorError,
    filter: { 'default': null, ':hover': 'brightness(1.15)' },
  },
  canvas: {
    cursor: 'crosshair',
    userSelect: 'none',
  },
  // Drawn regions are draggable as a whole; the corner handle resizes.
  editableRect: {
    pointerEvents: 'auto',
    cursor: 'move',
  },
  frame: {
    position: 'relative',
    overflow: 'hidden',
    display: 'inline-block',
    // Shrink-wrap the image exactly — a stretched frame skews every rect.
    alignSelf: 'flex-start',
    width: 'fit-content',
    maxWidth: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  image: {
    display: 'block',
    maxWidth: '100%',
  },
  rect: {
    position: 'absolute',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorError,
    borderRadius: '4px',
    // Two rings instead of one: the dark outside separates the box from a white
    // screenshot, the light inside separates it from a dark one. The evidence
    // image can be either, and neither the hue nor the reader's theme can tell
    // us which — so the box carries its own contrast.
    boxShadow: '0 0 0 1px rgb(0 0 0 / 45%), inset 0 0 0 1px rgb(255 255 255 / 45%)',
  },
  resizeHandle: {
    'cursor': 'nwse-resize',
    'position': 'absolute',
    'insetBlockEnd': '-6px',
    'insetInlineEnd': '-6px',
    'width': '12px',
    'height': '12px',
    'borderWidth': '2px',
    'borderStyle': 'solid',
    'borderColor': cssVar.colorError,
    'borderRadius': '50%',
    'backgroundColor': cssVar.colorBgContainer,
    '::after': {
      content: '""',
      position: 'absolute',
      insetBlockStart: '-16px',
      insetBlockEnd: '-16px',
      insetInlineStart: '-16px',
      insetInlineEnd: '-16px',
    },
  },
});

const rectStyle = (rect: Rect) => ({
  height: `${rect.height * 100}%`,
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
});

interface AnnotatedImageProps {
  /**
   * Each region carries the colour of whoever drew it — see
   * {@link EvidenceOverlay}. `label` overrides the badge number: regions
   * belonging to one review may be spread across several images, and per-image
   * numbering would restart at 1 on each.
   */
  annotations: EvidenceOverlay[];
  imageStyle?: React.CSSProperties;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  /** Render the per-region notes under the image. Off when a caller already lists them. */
  showComments?: boolean;
  src: string;
}

/** An evidence image with its circled regions (read-only display). */
export const AnnotatedImage = memo<AnnotatedImageProps>(
  ({ annotations, imageStyle, onLoad, showComments = true, src }) => {
    // A badge is noise on a single unnumbered region, but required as soon as
    // anything refers to a region by number.
    const numbered = annotations.length > 1 || annotations.some((item) => item.label !== undefined);

    return (
      <Flexbox gap={6} style={{ maxWidth: '100%', width: 'fit-content' }}>
        <div {...stylex.props(styles.frame)}>
          <img alt={''} src={src} onLoad={onLoad} {...sx([styles.image], undefined, imageStyle)} />
          {annotations.map((annotation, index) => (
            <div
              key={index}
              {...sx([styles.rect], undefined, {
                ...rectStyle(annotation.rect),
                borderColor: annotation.color ?? cssVar.colorError,
              })}
            >
              {numbered && (
                <span
                  {...sx([styles.badge], undefined, {
                    background: annotation.color ?? cssVar.colorError,
                  })}
                >
                  {annotation.label ?? index + 1}
                </span>
              )}
            </div>
          ))}
        </div>
        {showComments && (
          <Flexbox gap={2}>
            {annotations.map(
              (annotation, index) =>
                annotation.comment && (
                  <Text fontSize={12} key={index} type={'secondary'}>
                    {numbered ? `${annotation.label ?? index + 1}. ` : ''}
                    {annotation.authorName ? `${annotation.authorName}: ` : ''}
                    {annotation.comment}
                  </Text>
                ),
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

AnnotatedImage.displayName = 'AcceptanceAnnotatedImage';

export interface DraftAnnotation {
  comment: string;
  rect: Rect;
}

interface AnnotationCanvasProps {
  annotations: DraftAnnotation[];
  drawing?: boolean;
  /**
   * Explicit display width (CSS px) — the host computes viewport × zoom.
   * Rects are normalized to the image box, so zooming never remaps them; the
   * host's scroll container doubles as panning when zoomed in.
   */
  imageWidth?: number;
  onDraw: (rect: Rect) => void;
  onRemove: (index: number) => void;
  /** Reposition / resize an existing region. */
  onUpdate: (index: number, rect: Rect) => void;
  src: string;
}

/**
 * Drag on the image to circle a region; drag a region to move it, drag its
 * corner handle to resize; each region carries its own note.
 */
export const AnnotationCanvas = memo<AnnotationCanvasProps>(
  ({ annotations, drawing = true, imageWidth, onDraw, onRemove, onUpdate, src }) => {
    const { draft, handlers, imageRef, startEdit } = useAnnotationGesture({
      drawing,
      onDraw,
      onUpdate,
    });

    return (
      <div
        {...handlers}
        {...sx(
          [styles.frame, styles.canvas],
          undefined,
          // With an explicit zoomed width the frame must OUTGROW its host —
          // capping at 100% would clip the image instead of letting the host
          // viewport scroll/pan over it.
          {
            maxWidth: imageWidth ? 'none' : undefined,
            touchAction: drawing ? 'none' : 'pan-x pan-y',
            cursor: drawing ? 'crosshair' : 'auto',
          },
        )}
      >
        <img
          alt={''}
          draggable={false}
          ref={imageRef}
          src={src}
          // Zoomed width comes from the host (viewport × zoom); the frame
          // shrink-wraps the image, so overlays track exactly.
          {...sx(
            [styles.image],
            undefined,
            imageWidth ? { maxWidth: 'none', width: imageWidth } : undefined,
          )}
        />
        {annotations.map((annotation, index) => (
          <div
            key={index}
            {...sx([styles.rect, styles.editableRect], undefined, {
              ...rectStyle(annotation.rect),
              pointerEvents: drawing ? 'auto' : 'none',
            })}
            onPointerDown={(event) => startEdit(event, index, annotation.rect, 'move')}
          >
            <span {...stylex.props(styles.badge)}>{index + 1}</span>
            <button
              {...stylex.props(styles.badgeDelete)}
              type={'button'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(index);
              }}
            >
              <Icon icon={Trash2} size={11} />
            </button>
            <span
              {...stylex.props(styles.resizeHandle)}
              onPointerDown={(event) => startEdit(event, index, annotation.rect, 'resize')}
            />
          </div>
        ))}
        {draft && <div {...sx([styles.rect], undefined, rectStyle(draft))} />}
      </div>
    );
  },
);

AnnotationCanvas.displayName = 'AcceptanceAnnotationCanvas';
