'use client';

import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo, useRef, useState } from 'react';

/**
 * Region-comment primitives for acceptance evidence images. Rects are stored
 * normalized (0–1) against the image box, so the same annotation renders
 * correctly at any display size — editor, row detail, iteration history.
 */

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
  frame: css`
    position: relative;

    overflow: hidden;
    display: inline-block;

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
}));

const rectStyle = (rect: AcceptanceReviewAnnotation['rect']) => ({
  height: `${rect.height * 100}%`,
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
});

interface AnnotatedImageProps {
  annotations: { comment?: string; rect: AcceptanceReviewAnnotation['rect'] }[];
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
  rect: AcceptanceReviewAnnotation['rect'];
}

interface AnnotationCanvasProps {
  annotations: DraftAnnotation[];
  onDraw: (rect: AcceptanceReviewAnnotation['rect']) => void;
  onRemove: (index: number) => void;
  src: string;
}

/** Drag on the image to circle a region; each region carries its own note. */
export const AnnotationCanvas = memo<AnnotationCanvasProps>(
  ({ annotations, onDraw, onRemove, src }) => {
    const frameRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<AcceptanceReviewAnnotation['rect'] | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);

    const normalize = (event: React.MouseEvent) => {
      const box = frameRef.current?.getBoundingClientRect();
      if (!box) return null;
      return {
        x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
        y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1),
      };
    };

    const toRect = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      height: Math.abs(a.y - b.y),
      width: Math.abs(a.x - b.x),
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
    });

    return (
      <div
        className={`${styles.frame} ${styles.canvas}`}
        ref={frameRef}
        onMouseDown={(event) => {
          event.preventDefault();
          startRef.current = normalize(event);
        }}
        onMouseLeave={() => {
          startRef.current = null;
          setDraft(null);
        }}
        onMouseMove={(event) => {
          if (!startRef.current) return;
          const point = normalize(event);
          if (point) setDraft(toRect(startRef.current, point));
        }}
        onMouseUp={(event) => {
          const start = startRef.current;
          startRef.current = null;
          setDraft(null);
          const point = normalize(event);
          if (!start || !point) return;
          const rect = toRect(start, point);
          // Ignore accidental clicks — a region needs real area to comment on.
          if (rect.width < 0.01 || rect.height < 0.01) return;
          onDraw(rect);
        }}
      >
        <img alt={''} className={styles.image} draggable={false} src={src} />
        {annotations.map((annotation, index) => (
          <div className={styles.rect} key={index} style={rectStyle(annotation.rect)}>
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
          </div>
        ))}
        {draft && <div className={styles.rect} style={rectStyle(draft)} />}
      </div>
    );
  },
);

AnnotationCanvas.displayName = 'AcceptanceAnnotationCanvas';
