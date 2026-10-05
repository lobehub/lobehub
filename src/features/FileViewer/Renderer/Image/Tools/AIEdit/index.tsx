'use client';

import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, keyframes } from 'antd-style';
import { CircleAlertIcon, LoaderCircleIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useImageStage } from '../../context';
import { type BrushShape, drawShapes, isMeaningfulShape } from '../Annotate/shapes';
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

const sweep = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
`;
const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const styles = createStaticStyles(({ css }) => ({
  error: css`
    display: flex;
    gap: 6px;
    align-items: center;

    max-width: 420px;
    padding-inline: 8px;

    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  mask: css`
    opacity: 0.5;
  `,
  progress: css`
    pointer-events: none;
    position: absolute;
    inset: 0;
    overflow: hidden;

    &::after {
      content: '';

      position: absolute;
      inset: 0;

      background: linear-gradient(
        90deg,
        transparent 0%,
        rgb(255 255 255 / 35%) 50%,
        transparent 100%
      );

      animation: ${sweep} 1.6s ease-in-out infinite;
    }
  `,
  spinner: css`
    animation: ${spin} 1s linear infinite;
  `,
  status: css`
    display: flex;
    gap: 6px;
    align-items: center;

    padding-inline: 8px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
}));

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
  const { overlayElement, toImagePoint, url } = useImageStage();
  const { cancel, reset, run, state } = useAIImageEdit(operation, deps);
  const running = state.status === 'running';
  const isErase = operation === 'erase';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sizeKey, setSizeKey] = useState<BrushSizeKey>('medium');
  const [strokes, setStrokes] = useState<BrushShape[]>([]);
  const [draft, setDraftState] = useState<BrushShape | null>(null);
  const draftRef = useRef<BrushShape | null>(null);
  const setDraft = (value: BrushShape | null) => {
    draftRef.current = value;
    setDraftState(value);
  };

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
    drawShapes(ctx, draft ? [...strokes, draft] : strokes, canvas.width, canvas.height);
  }, [draft, strokes]);

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
    setDraft({
      color: ERASE_MARK_COLOR,
      points: [point, point],
      size: ERASE_BRUSH_SIZES[sizeKey],
      type: 'brush',
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const value = draftRef.current;
    if (!value) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    setDraft({ ...value, points: [...value.points, point] });
  };

  const handlePointerUp = () => {
    const value = draftRef.current;
    if (value && isMeaningfulShape(value)) setStrokes((list) => [...list, value]);
    setDraft(null);
  };

  const label = t(`imageViewer.tool.${operation}`);

  const renderStatus = () => {
    if (state.status === 'running') {
      const seconds = Math.max(0, Math.round((now - state.startedAt) / 1000));
      return (
        <span aria-live={'polite'} className={styles.status} role={'status'}>
          <LoaderCircleIcon className={styles.spinner} size={14} />
          {t(`imageViewer.ai.phase.${state.phase}`, { seconds })}
        </span>
      );
    }
    if (state.status === 'error') {
      return (
        // The provider's raw message stays one hover away instead of in the line.
        <span
          className={styles.error}
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
      <span className={toolStyles.hint}>
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
                className={`${toolStyles.overlayFill} ${styles.mask}`}
                data-testid={'image-erase-canvas'}
                ref={canvasRef}
                role={'img'}
                style={{
                  cursor: running ? 'progress' : 'crosshair',
                  height: '100%',
                  touchAction: 'none',
                  width: '100%',
                }}
                onPointerCancel={handlePointerUp}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            )}
            {running && <div className={styles.progress} data-testid={'image-ai-progress'} />}
          </>,
          overlayElement,
        )}
      <div className={toolStyles.dock}>
        <div aria-label={label} className={toolStyles.bar} role={'toolbar'}>
          {isErase && !running && (
            <>
              <div
                aria-label={t('imageViewer.ai.brushSize')}
                role={'group'}
                style={{ display: 'flex' }}
              >
                {(Object.keys(ERASE_BRUSH_SIZES) as BrushSizeKey[]).map((key, index) => (
                  <ActionIcon
                    active={sizeKey === key}
                    aria-label={`${t('imageViewer.ai.brushSize')} ${index + 1}`}
                    aria-pressed={sizeKey === key}
                    key={key}
                    size={'small'}
                    icon={
                      <span
                        style={{
                          background: 'currentColor',
                          borderRadius: '50%',
                          display: 'block',
                          height: 6 + index * 4,
                          width: 6 + index * 4,
                        }}
                      />
                    }
                    onClick={() => setSizeKey(key)}
                  />
                ))}
              </div>
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
              <span className={toolStyles.divider} />
            </>
          )}
          {renderStatus()}
          <span className={toolStyles.divider} />
          {running ? (
            <Button shape={'round'} size={'small'} onClick={cancel}>
              {t('imageViewer.cancel')}
            </Button>
          ) : (
            <>
              <Button shape={'round'} size={'small'} onClick={onExit}>
                {state.status === 'error' ? t('imageViewer.close') : t('imageViewer.cancel')}
              </Button>
              {/* A job that may still be running must not be submitted twice. */}
              {!(state.status === 'error' && state.taskRunning) && (
                <Button
                  disabled={!canSubmit}
                  shape={'round'}
                  size={'small'}
                  type={'primary'}
                  title={
                    isErase && strokes.length === 0 ? t('imageViewer.ai.erase.empty') : undefined
                  }
                  onClick={() => void submit()}
                >
                  {state.status === 'error'
                    ? t('imageViewer.retry')
                    : t(
                        isErase
                          ? 'imageViewer.ai.erase.start'
                          : 'imageViewer.ai.removeBackground.start',
                      )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default AIEditMode;
