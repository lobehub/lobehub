'use client';

import { ActionIcon } from '@lobehub/ui/base-ui';
import { BrushIcon, CheckIcon, SquareIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useImageStage } from '../../context';
import type { Point } from '../../geometry';
import BarButton from '../BarButton';
import type { ImageMarkup } from '../markup';
import MarkupPreview from '../MarkupPreview';
import SendToChatButton from '../SendToChatButton';
import { toolStyles as styles } from '../styles';
import { useToolKeys } from '../useToolKeys';
import {
  ANNOTATION_COLOR_NAMES,
  ANNOTATION_COLORS,
  ANNOTATION_SIZES,
  type AnnotationShape,
  type AnnotationTool,
  drawBrushSegment,
  drawShapes,
  isMeaningfulShape,
  rectFromPoints,
} from './shapes';

type SizeKey = keyof typeof ANNOTATION_SIZES;
type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

/** Thinnest first, so the dots grow left to right. */
const SIZE_KEYS: SizeKey[] = ['small', 'medium', 'large'];

const nextOf = <T,>(list: readonly T[], current: T) =>
  list[(list.indexOf(current) + 1) % list.length];

/** A dot whose size shows the stroke width. */
const SizeDot = ({ index }: { index: number }) => (
  <span
    style={{
      background: 'currentColor',
      borderRadius: '50%',
      display: 'block',
      height: 4 + index * 3,
      width: 4 + index * 3,
    }}
  />
);

interface AnnotateModeProps {
  markup: ImageMarkup;
  onChange: (markup: ImageMarkup) => void;
  onExit: () => void;
  onSent: (sent: ImageMarkup) => void;
}

/**
 * Brush and box annotations drawn over the image. They stay in the viewer's
 * memory until the user adds the marked-up image to a chat message.
 */
const AnnotateMode = ({ markup, onChange, onExit, onSent }: AnnotateModeProps) => {
  const { t } = useTranslation('file');
  const { compact, overlayElement, toImagePoint } = useImageStage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStart = useRef<Point | null>(null);

  const [tool, setTool] = useState<AnnotationTool>('brush');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [sizeKey, setSizeKey] = useState<SizeKey>('medium');
  const { shapes } = markup;
  const setShapes = (update: (value: AnnotationShape[]) => AnnotationShape[]) =>
    onChange({ ...markup, shapes: update(shapes) });
  const [redrawKey, setRedrawKey] = useState(0);
  const [draft, setDraftState] = useState<AnnotationShape | null>(null);
  const draftRef = useRef<AnnotationShape | null>(null);
  const setDraft = (value: AnnotationShape | null) => {
    draftRef.current = value;
    setDraftState(value);
  };

  // Keep the canvas backing store matched to its displayed size so strokes stay crisp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !overlayElement) return;
    const sync = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(overlayElement.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(overlayElement.clientHeight * ratio));
      setRedrawKey((value) => value + 1);
    };
    sync();
    if (!('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(sync);
    observer.observe(overlayElement);
    return () => observer.disconnect();
  }, [overlayElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The live brush stroke lives in the ref (it grows without re-rendering).
    const live = draft ?? draftRef.current;
    drawShapes(ctx, live ? [...shapes, live] : shapes, canvas.width, canvas.height);
  }, [draft, shapes, redrawKey]);

  const undo = () => setShapes((value) => value.slice(0, -1));

  useToolKeys({ onEscape: onExit, onUndo: undo });

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = point;
    const style = { color, size: ANNOTATION_SIZES[sizeKey] };
    if (tool === 'brush') draftRef.current = { ...style, points: [point], type: 'brush' };
    else setDraft({ ...style, rect: rectFromPoints(point, point), type: 'rect' });
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    const value = draftRef.current;
    if (!value) return;
    if (value.type === 'rect') return setDraft({ ...value, rect: rectFromPoints(start, point) });

    // Brush: grow the stroke in place and paint only the new segment.
    const last = value.points.at(-1)!;
    value.points.push(point);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) drawBrushSegment(ctx, value, last, point, canvas.width, canvas.height);
  };

  const handlePointerUp = () => {
    dragStart.current = null;
    const value = draftRef.current;
    if (value && isMeaningfulShape(value)) setShapes((list) => [...list, value]);
    setDraft(null);
  };

  return (
    <>
      <MarkupPreview comments={markup.comments} />
      {overlayElement &&
        createPortal(
          <canvas
            aria-label={t('imageViewer.annotate.hint')}
            className={styles.overlayFill}
            data-testid={'image-annotate-canvas'}
            ref={canvasRef}
            role={'img'}
            style={{ cursor: 'crosshair', height: '100%', touchAction: 'none', width: '100%' }}
            onPointerCancel={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />,
          overlayElement,
        )}
      <div className={styles.dock}>
        <div aria-label={t('imageViewer.tool.annotate')} className={styles.bar} role={'toolbar'}>
          <ActionIcon
            active={tool === 'brush'}
            aria-label={t('imageViewer.annotate.brush')}
            aria-pressed={tool === 'brush'}
            icon={BrushIcon}
            size={'small'}
            title={t('imageViewer.annotate.brush')}
            onClick={() => setTool('brush')}
          />
          <ActionIcon
            active={tool === 'rect'}
            aria-label={t('imageViewer.annotate.rect')}
            aria-pressed={tool === 'rect'}
            icon={SquareIcon}
            size={'small'}
            title={t('imageViewer.annotate.rect')}
            onClick={() => setTool('rect')}
          />
          <span className={styles.divider} />
          {compact ? (
            // One swatch that steps through the colors keeps a narrow bar on one line.
            <button
              aria-label={`${t('imageViewer.annotate.color')}: ${t(`imageViewer.annotate.colorName.${ANNOTATION_COLOR_NAMES[color as AnnotationColor]}`)}`}
              className={styles.swatch}
              style={{ background: color }}
              title={t('imageViewer.annotate.color')}
              type={'button'}
              onClick={() => setColor(nextOf(ANNOTATION_COLORS, color as AnnotationColor))}
            />
          ) : (
            <div
              aria-label={t('imageViewer.annotate.color')}
              role={'group'}
              style={{ display: 'flex', gap: 6 }}
            >
              {ANNOTATION_COLORS.map((value) => (
                <button
                  aria-label={t(`imageViewer.annotate.colorName.${ANNOTATION_COLOR_NAMES[value]}`)}
                  aria-pressed={color === value}
                  className={styles.swatch}
                  key={value}
                  style={{ background: value }}
                  type={'button'}
                  onClick={() => setColor(value)}
                />
              ))}
            </div>
          )}
          <span className={styles.divider} />
          {compact ? (
            <ActionIcon
              aria-label={t('imageViewer.annotate.size')}
              icon={<SizeDot index={SIZE_KEYS.indexOf(sizeKey)} />}
              size={'small'}
              title={t('imageViewer.annotate.size')}
              onClick={() => setSizeKey(nextOf(SIZE_KEYS, sizeKey))}
            />
          ) : (
            <div
              aria-label={t('imageViewer.annotate.size')}
              role={'group'}
              style={{ display: 'flex' }}
            >
              {SIZE_KEYS.map((key, index) => (
                <ActionIcon
                  active={sizeKey === key}
                  aria-label={`${t('imageViewer.annotate.size')} ${index + 1}`}
                  aria-pressed={sizeKey === key}
                  icon={<SizeDot index={index} />}
                  key={key}
                  size={'small'}
                  onClick={() => setSizeKey(key)}
                />
              ))}
            </div>
          )}
          <span className={styles.divider} />
          <ActionIcon
            aria-label={t('imageViewer.annotate.undo')}
            disabled={shapes.length === 0}
            icon={Undo2Icon}
            size={'small'}
            title={t('imageViewer.annotate.undo')}
            onClick={undo}
          />
          <ActionIcon
            aria-label={t('imageViewer.annotate.clear')}
            disabled={shapes.length === 0}
            icon={Trash2Icon}
            size={'small'}
            title={t('imageViewer.annotate.clear')}
            onClick={() => setShapes(() => [])}
          />
          <span className={styles.divider} />
          <BarButton icon={CheckIcon} label={t('imageViewer.done')} onClick={onExit} />
          <SendToChatButton markup={markup} onSent={onSent} />
        </div>
      </div>
    </>
  );
};

export default AnnotateMode;
