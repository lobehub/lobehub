'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo, useRef, useState } from 'react';

/**
 * Region-comment primitives for acceptance evidence images. Rects are stored
 * normalized (0–1) against the IMAGE box — never the surrounding frame. A
 * frame can silently grow wider than the image it holds (flex stretch, long
 * sibling text driving fit-content), and any rect normalized or rendered
 * against that bigger box lands visibly off the pixels the user circled.
 */

type Rect = AcceptanceReviewAnnotation['rect'];

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    position: absolute;
    inset-block-start: -9px;
    inset-inline-start: -9px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border-radius: 50%;

    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: #fff;

    background: ${cssVar.colorError};
  `,
  /* Delete mirrors the index badge on the opposite corner — the same pink
     disc, so which region the action removes reads at a glance. */
  badgeDelete: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: -9px;
    inset-inline-end: -9px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;

    color: #fff;

    background: ${cssVar.colorError};

    &:hover {
      filter: brightness(1.15);
    }
  `,
  canvas: css`
    cursor: crosshair;
    user-select: none;
  `,
  /* Drawn regions are draggable as a whole; the corner handle resizes. */
  editableRect: css`
    pointer-events: auto;
    cursor: move;
  `,
  frame: css`
    position: relative;

    overflow: hidden;
    display: inline-block;

    /* Shrink-wrap the image exactly — a stretched frame skews every rect. */
    align-self: flex-start;

    width: fit-content;
    max-width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  image: css`
    display: block;
    max-width: 100%;
  `,
  rect: css`
    position: absolute;
    border: 2px solid ${cssVar.colorError};
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 25%);
  `,
  resizeHandle: css`
    cursor: nwse-resize;

    position: absolute;
    inset-block-end: -6px;
    inset-inline-end: -6px;

    width: 12px;
    height: 12px;
    border: 2px solid ${cssVar.colorError};
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,
}));

const rectStyle = (rect: Rect) => ({
  height: `${rect.height * 100}%`,
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
});

interface AnnotatedImageProps {
  annotations: { comment?: string; rect: Rect }[];
  imageStyle?: React.CSSProperties;
  src: string;
}

/** An evidence image with its circled regions (read-only display). */
export const AnnotatedImage = memo<AnnotatedImageProps>(({ annotations, imageStyle, src }) => (
  <Flexbox gap={6} style={{ maxWidth: '100%', width: 'fit-content' }}>
    <div className={styles.frame}>
      <img alt={''} className={styles.image} src={src} style={imageStyle} />
      {annotations.map((annotation, index) => (
        <div className={styles.rect} key={index} style={rectStyle(annotation.rect)}>
          {annotations.length > 1 && <span className={styles.badge}>{index + 1}</span>}
        </div>
      ))}
    </div>
    <Flexbox gap={2}>
      {annotations.map(
        (annotation, index) =>
          annotation.comment && (
            <Text fontSize={12} key={index} type={'secondary'}>
              {annotations.length > 1 ? `${index + 1}. ` : ''}
              {annotation.comment}
            </Text>
          ),
      )}
    </Flexbox>
  </Flexbox>
));

AnnotatedImage.displayName = 'AcceptanceAnnotatedImage';

export interface DraftAnnotation {
  comment: string;
  rect: Rect;
}

interface AnnotationCanvasProps {
  annotations: DraftAnnotation[];
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

/** An in-flight pointer gesture: drawing a new region, or moving/resizing one. */
type Gesture =
  | { kind: 'draw'; start: { x: number; y: number } }
  | { index: number; kind: 'move'; origin: Rect; start: { x: number; y: number } }
  | { index: number; kind: 'resize'; origin: Rect };

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

/**
 * Drag on the image to circle a region; drag a region to move it, drag its
 * corner handle to resize; each region carries its own note.
 */
export const AnnotationCanvas = memo<AnnotationCanvasProps>(
  ({ annotations, imageWidth, onDraw, onRemove, onUpdate, src }) => {
    const imageRef = useRef<HTMLImageElement>(null);
    const [draft, setDraft] = useState<Rect | null>(null);
    const gestureRef = useRef<Gesture | null>(null);

    // Normalize against the image's own box — the frame may not equal it.
    const normalize = (event: React.MouseEvent) => {
      const box = imageRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return null;
      return {
        x: clamp01((event.clientX - box.left) / box.width),
        y: clamp01((event.clientY - box.top) / box.height),
      };
    };

    const toRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
      height: Math.abs(a.y - b.y),
      width: Math.abs(a.x - b.x),
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
    });

    const endGesture = (event: React.MouseEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      setDraft(null);
      if (gesture?.kind !== 'draw') return;
      const point = normalize(event);
      if (!point) return;
      const rect = toRect(gesture.start, point);
      // Ignore accidental clicks — a region needs real area to comment on.
      if (rect.width < 0.01 || rect.height < 0.01) return;
      onDraw(rect);
    };

    return (
      <div
        className={`${styles.frame} ${styles.canvas}`}
        // With an explicit zoomed width the frame must OUTGROW its host —
        // capping at 100% would clip the image instead of letting the host
        // viewport scroll/pan over it.
        style={imageWidth ? { maxWidth: 'none' } : undefined}
        onMouseUp={endGesture}
        onMouseDown={(event) => {
          event.preventDefault();
          const start = normalize(event);
          if (start) gestureRef.current = { kind: 'draw', start };
        }}
        onMouseLeave={() => {
          gestureRef.current = null;
          setDraft(null);
        }}
        onMouseMove={(event) => {
          const gesture = gestureRef.current;
          if (!gesture) return;
          const point = normalize(event);
          if (!point) return;
          if (gesture.kind === 'draw') {
            setDraft(toRect(gesture.start, point));
            return;
          }
          const { index, origin } = gesture;
          if (gesture.kind === 'move') {
            onUpdate(index, {
              ...origin,
              x: Math.min(Math.max(origin.x + (point.x - gesture.start.x), 0), 1 - origin.width),
              y: Math.min(Math.max(origin.y + (point.y - gesture.start.y), 0), 1 - origin.height),
            });
            return;
          }
          // resize — the origin's top-left corner stays anchored.
          onUpdate(index, {
            height: Math.max(point.y - origin.y, 0.01),
            width: Math.max(point.x - origin.x, 0.01),
            x: origin.x,
            y: origin.y,
          });
        }}
      >
        <img
          alt={''}
          className={styles.image}
          draggable={false}
          ref={imageRef}
          src={src}
          // Zoomed width comes from the host (viewport × zoom); the frame
          // shrink-wraps the image, so overlays track exactly.
          style={imageWidth ? { maxWidth: 'none', width: imageWidth } : undefined}
        />
        {annotations.map((annotation, index) => (
          <div
            className={`${styles.rect} ${styles.editableRect}`}
            key={index}
            style={rectStyle(annotation.rect)}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const start = normalize(event);
              if (start)
                gestureRef.current = { index, kind: 'move', origin: annotation.rect, start };
            }}
          >
            <span className={styles.badge}>{index + 1}</span>
            <button
              className={styles.badgeDelete}
              type={'button'}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(index);
              }}
            >
              <Icon icon={Trash2} size={11} />
            </button>
            <span
              className={styles.resizeHandle}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                gestureRef.current = { index, kind: 'resize', origin: annotation.rect };
              }}
            />
          </div>
        ))}
        {draft && <div className={styles.rect} style={rectStyle(draft)} />}
      </div>
    );
  },
);

AnnotationCanvas.displayName = 'AcceptanceAnnotationCanvas';
