'use client';

import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CircleAlertIcon,
  EraserIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  Trash2Icon,
  Undo2Icon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import type { PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useImageStage } from '../../context';
import {
  type BrushShape,
  drawBrushSegment,
  drawShapes,
  isMeaningfulShape,
} from '../Annotate/shapes';
import BarButton from '../BarButton';
import { renderImageToBlob } from '../exportImage';
import { toolStyles } from '../styles';
import { useToolKeys } from '../useToolKeys';
import { loadStageImage } from './deps';
import { type AIEditOperation, ERASE_MARK_COLOR } from './request';
import type { AIEditDeps } from './runAIImageEdit';
import { useAIImageEdit } from './useAIImageEdit';

/** Brush widths as a fraction of the image's shorter side; erase strokes are broad. */
export const ERASE_BRUSH_SIZES = { large: 0.07, medium: 0.04, small: 0.02 } as const;
type BrushSizeKey = keyof typeof ERASE_BRUSH_SIZES;
/** Smallest first, so the dots grow left to right. */
const BRUSH_KEYS: BrushSizeKey[] = ['small', 'medium', 'large'];

/** A dot whose size shows the brush size. */
const BrushDot = ({ index }: { index: number }) => (
  <span
    style={{
      background: 'currentColor',
      borderRadius: '50%',
      display: 'block',
      height: 6 + index * 4,
      width: 6 + index * 4,
    }}
  />
);

const sweep = stylex.keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(100%)' },
});
const spin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

const styles = stylex.create({
  error: {
    overflow: 'hidden',
    display: 'flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '420px',
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorError,
    whiteSpace: 'nowrap',
  },
  mask: { opacity: 0.5 },
  progress: {
    'pointerEvents': 'none',
    'position': 'absolute',
    'inset': 0,
    'overflow': 'hidden',
    '::after': {
      content: '""',
      position: 'absolute',
      inset: 0,
      backgroundImage:
        'linear-gradient(90deg, transparent 0%, rgb(255 255 255 / 35%) 50%, transparent 100%)',
      animationName: sweep,
      animationDuration: '1.6s',
      animationTimingFunction: 'ease-in-out',
      animationIterationCount: 'infinite',
    },
  },
  spinner: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  status: {
    overflow: 'hidden',
    display: 'flex',
    flexShrink: 1,
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
    paddingInline: '8px',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
});

interface AIEditModeProps {
  /** Injected in tests; defaults to the real image generation services. */
  deps?: AIEditDeps;
  onExit: () => void;
  operation: AIEditOperation;
}

/**
 * Remove background / erase with an image model. Erase first collects brush
 * strokes over the region to remove; both submit the image to the generation
 * pipeline and save the output as a new file, never touching the original.
 */
const AIEditMode = ({ deps, onExit, operation }: AIEditModeProps) => {
  const { t } = useTranslation('file');
  const { compact, overlayElement, toImagePoint, url } = useImageStage();
  const { cancel, reset, run, state } = useAIImageEdit(operation, deps);
  const running = state.status === 'running';
  const isErase = operation === 'erase';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sizeKey, setSizeKey] = useState<BrushSizeKey>('medium');
  const [strokes, setStrokes] = useState<BrushShape[]>([]);
  // The stroke being painted; it grows in place and is drawn segment by segment.
  const draftRef = useRef<BrushShape | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Keep the mask canvas backing store matched to its displayed size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isErase || !canvas || !overlayElement) return;
    const sync = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(overlayElement.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(overlayElement.clientHeight * ratio));
      setStrokes((value) => [...value]);
    };
    sync();
    if (!('ResizeObserver' in window)) return;
    const observer = new ResizeObserver(sync);
    observer.observe(overlayElement);
    return () => observer.disconnect();
  }, [isErase, overlayElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The live stroke lives in the ref (it grows without re-rendering).
    const live = draftRef.current;
    drawShapes(ctx, live ? [...strokes, live] : strokes, canvas.width, canvas.height);
  }, [strokes]);

  const canSubmit = !running && (!isErase || strokes.length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    // The guide is rendered inside the run, so Start is locked and Cancel or
    // leaving the tool abort it before any job is submitted.
    const prepareGuide = isErase
      ? async () => renderImageToBlob(await loadStageImage(url), { shapes: strokes })
      : undefined;
    const result = await run(prepareGuide);
    if (result) onExit();
  };

  const undo = () => setStrokes((value) => value.slice(0, -1));

  useToolKeys({
    onEnter: () => void submit(),
    onEscape: running ? cancel : onExit,
    onUndo: isErase && !running ? undo : undefined,
  });

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || running) return;
    event.stopPropagation();
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (state.status === 'error') reset();
    // The stroke grows in place on later moves, without re-rendering.
    draftRef.current = {
      color: ERASE_MARK_COLOR,
      points: [point, point],
      size: ERASE_BRUSH_SIZES[sizeKey],
      type: 'brush',
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const value = draftRef.current;
    if (!value) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    // Grow the stroke in place and paint only the new segment.
    const last = value.points.at(-1)!;
    value.points.push(point);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) drawBrushSegment(ctx, value, last, point, canvas.width, canvas.height);
  };

  const handlePointerUp = () => {
    const value = draftRef.current;
    if (value && isMeaningfulShape(value)) setStrokes((list) => [...list, value]);
    draftRef.current = null;
  };

  const label = t(`imageViewer.tool.${operation}`);

  const renderStatus = () => {
    if (state.status === 'running') {
      const seconds = Math.max(0, Math.round((now - state.startedAt) / 1000));
      return (
        <span aria-live={'polite'} {...stylex.props(styles.status)} role={'status'}>
          <LoaderCircleIcon className={stylex.props(styles.spinner).className} size={14} />
          {t(`imageViewer.ai.phase.${state.phase}`, { seconds })}
        </span>
      );
    }
    if (state.status === 'error') {
      return (
        // The provider's raw message stays one hover away instead of in the line.
        <span
          {...stylex.props(styles.error)}
          role={'alert'}
          title={state.kind === 'failed' ? state.message : undefined}
        >
          <CircleAlertIcon size={14} style={{ flexShrink: 0 }} />
          {t(
            state.taskRunning && state.kind !== 'timeout'
              ? 'imageViewer.ai.error.lostTrack'
              : `imageViewer.ai.error.${state.kind}`,
          )}
        </span>
      );
    }
    return (
      <span {...stylex.props(toolStyles.hint)}>
        {t(isErase ? 'imageViewer.ai.erase.hint' : 'imageViewer.ai.removeBackground.hint')}
      </span>
    );
  };

  return (
    <>
      {overlayElement &&
        createPortal(
          <>
            {isErase && (
              <canvas
                aria-label={t('imageViewer.ai.erase.hint')}
                data-testid={'image-erase-canvas'}
                ref={canvasRef}
                role={'img'}
                {...sx([toolStyles.overlayFill, styles.mask], undefined, {
                  cursor: running ? 'progress' : 'crosshair',
                  height: '100%',
                  touchAction: 'none',
                  width: '100%',
                })}
                onPointerCancel={handlePointerUp}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            )}
            {running && (
              <div {...stylex.props(styles.progress)} data-testid={'image-ai-progress'} />
            )}
          </>,
          overlayElement,
        )}
      <div {...stylex.props(toolStyles.dock)}>
        <div aria-label={label} {...stylex.props(toolStyles.bar)} role={'toolbar'}>
          {isErase && !running && (
            <>
              {compact ? (
                <ActionIcon
                  aria-label={t('imageViewer.ai.brushSize')}
                  icon={<BrushDot index={BRUSH_KEYS.indexOf(sizeKey)} />}
                  size={'small'}
                  title={t('imageViewer.ai.brushSize')}
                  onClick={() =>
                    setSizeKey(BRUSH_KEYS[(BRUSH_KEYS.indexOf(sizeKey) + 1) % BRUSH_KEYS.length])
                  }
                />
              ) : (
                <div
                  aria-label={t('imageViewer.ai.brushSize')}
                  role={'group'}
                  style={{ display: 'flex' }}
                >
                  {BRUSH_KEYS.map((key, index) => (
                    <ActionIcon
                      active={sizeKey === key}
                      aria-label={`${t('imageViewer.ai.brushSize')} ${index + 1}`}
                      aria-pressed={sizeKey === key}
                      icon={<BrushDot index={index} />}
                      key={key}
                      size={'small'}
                      onClick={() => setSizeKey(key)}
                    />
                  ))}
                </div>
              )}
              <ActionIcon
                aria-label={t('imageViewer.annotate.undo')}
                disabled={strokes.length === 0}
                icon={Undo2Icon}
                size={'small'}
                title={t('imageViewer.annotate.undo')}
                onClick={undo}
              />
              <ActionIcon
                aria-label={t('imageViewer.annotate.clear')}
                disabled={strokes.length === 0}
                icon={Trash2Icon}
                size={'small'}
                title={t('imageViewer.annotate.clear')}
                onClick={() => setStrokes([])}
              />
              <span {...stylex.props(toolStyles.divider)} />
            </>
          )}
          {renderStatus()}
          <span {...stylex.props(toolStyles.divider)} />
          {running ? (
            <BarButton icon={XIcon} label={t('imageViewer.cancel')} onClick={cancel} />
          ) : (
            <>
              <BarButton
                icon={XIcon}
                label={state.status === 'error' ? t('imageViewer.close') : t('imageViewer.cancel')}
                onClick={onExit}
              />
              {/* A job that may still be running must not be submitted twice. */}
              {!(state.status === 'error' && state.taskRunning) && (
                <BarButton
                  disabled={!canSubmit}
                  type={'primary'}
                  icon={
                    state.status === 'error'
                      ? RotateCcwIcon
                      : isErase
                        ? EraserIcon
                        : WandSparklesIcon
                  }
                  label={
                    state.status === 'error'
                      ? t('imageViewer.retry')
                      : t(
                          isErase
                            ? 'imageViewer.ai.erase.start'
                            : 'imageViewer.ai.removeBackground.start',
                        )
                  }
                  title={
                    isErase && strokes.length === 0 ? t('imageViewer.ai.erase.empty') : undefined
                  }
                  onClick={() => void submit()}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default AIEditMode;
