'use client';

import { ActionIcon, Input, Select } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { LinkIcon, SaveIcon, UnlinkIcon, XIcon } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useImageStage } from '../../context';
import type { NormalizedRect, Point, Size } from '../../geometry';
import BarButton from '../BarButton';
import { renderImageToBlob } from '../exportImage';
import { toolStyles } from '../styles';
import { useSaveDerivedImage } from '../useSaveDerivedImage';
import { useToolKeys } from '../useToolKeys';
import {
  ASPECT_PRESETS,
  type AspectPreset,
  aspectRatioOf,
  centeredCrop,
  type CropHandle,
  cropPixelSize,
  dragCrop,
  MAX_OUTPUT_EDGE,
  resolveOutputSize,
} from './crop';

const styles = createStaticStyles(({ css }) => ({
  box: css`
    cursor: move;
    position: absolute;
    border: 1px solid #fff;
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 45%);

    &::before,
    &::after {
      pointer-events: none;
      content: '';
      position: absolute;
      border: 0 dashed rgb(255 255 255 / 60%);
    }

    &::before {
      inset-block: 0;
      inset-inline: 33.33%;
      border-inline-width: 1px;
    }

    &::after {
      inset-block: 33.33%;
      inset-inline: 0;
      border-block-width: 1px;
    }
  `,
  clip: css`
    position: absolute;
    inset: 0;
    overflow: hidden;
  `,
  handle: css`
    position: absolute;
    z-index: 1;

    width: 14px;
    height: 14px;
    border: 2px solid ${cssVar.colorPrimary};
    border-radius: 3px;

    background: #fff;
  `,
  sizeInput: css`
    flex-shrink: 0;
    width: 84px;

    &[data-compact='true'] {
      width: 72px;
    }
  `,
}));

// Handles sit just inside the crop corners so they stay grabbable when the
// crop reaches the image edge (the layer clips anything outside the image).
const HANDLES: { cursor: string; handle: Exclude<CropHandle, 'move'>; x: string; y: string }[] = [
  { cursor: 'nwse-resize', handle: 'nw', x: '-1px', y: '-1px' },
  { cursor: 'nesw-resize', handle: 'ne', x: 'calc(100% - 13px)', y: '-1px' },
  { cursor: 'nesw-resize', handle: 'sw', x: '-1px', y: 'calc(100% - 13px)' },
  { cursor: 'nwse-resize', handle: 'se', x: 'calc(100% - 13px)', y: 'calc(100% - 13px)' },
];

interface ResizeModeProps {
  onExit: () => void;
}

/**
 * Crop to a region (free or a preset ratio) and scale to an exact pixel size,
 * then save the result as a new file.
 */
const ResizeMode = ({ onExit }: ResizeModeProps) => {
  const { t } = useTranslation('file');
  const { compact, naturalSize, overlayElement, toImagePoint } = useImageStage();
  const natural: Size = naturalSize ?? { height: 1, width: 1 };

  const [preset, setPreset] = useState<AspectPreset>('free');
  const [crop, setCropState] = useState<NormalizedRect>(() => centeredCrop(natural, undefined));
  const [output, setOutput] = useState<Size>(() => cropPixelSize(crop, natural));
  const [locked, setLocked] = useState(true);
  // What the user is typing, so a field can be emptied mid-edit.
  const [typing, setTyping] = useState<{ side: 'height' | 'width'; text: string } | null>(null);
  const drag = useRef<{ handle: CropHandle; point: Point; start: NormalizedRect } | null>(null);
  const { save, saving } = useSaveDerivedImage('resize');

  const aspect = aspectRatioOf(preset, natural);

  // A new crop resets the output to the crop's own pixel size.
  const setCrop = (next: NormalizedRect) => {
    setCropState(next);
    setOutput(cropPixelSize(next, natural));
    setTyping(null);
  };

  const handleSave = async () => {
    const result = await save((img) => renderImageToBlob(img, { crop, output }));
    if (result) onExit();
  };

  // While saving, Enter would start a duplicate upload and Escape would hide
  // an upload that still lands; the shortcuts wait for the save to finish.
  useToolKeys({
    onEnter: saving ? undefined : () => void handleSave(),
    onEscape: saving ? undefined : onExit,
  });

  const startDrag = (handle: CropHandle) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, point, start: crop };
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state) return;
    const point = toImagePoint({ x: event.clientX, y: event.clientY });
    if (!point) return;
    setCrop(
      dragCrop(
        state.start,
        state.handle,
        { x: point.x - state.point.x, y: point.y - state.point.y },
        natural,
        aspect,
      ),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const cropSize = cropPixelSize(crop, natural);

  const updateOutput = (edited: 'height' | 'width', value: string) => {
    setTyping({ side: edited, text: value });
    const numeric = Number(value);
    if (!value || !Number.isFinite(numeric) || numeric <= 0) return;
    setOutput(resolveOutputSize(cropSize, { ...output, [edited]: numeric, edited }, locked));
  };

  return (
    <>
      {overlayElement &&
        createPortal(
          <div
            className={styles.clip}
            data-testid={'image-resize-layer'}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              aria-label={`${cropSize.width} × ${cropSize.height}`}
              className={styles.box}
              data-testid={'image-crop-box'}
              role={'group'}
              style={{
                height: `${crop.height * 100}%`,
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                touchAction: 'none',
                width: `${crop.width * 100}%`,
              }}
              onPointerCancel={endDrag}
              onPointerDown={startDrag('move')}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
            >
              {HANDLES.map(({ cursor, handle, x, y }) => (
                <span
                  className={styles.handle}
                  data-handle={handle}
                  key={handle}
                  style={{ cursor, left: x, top: y, touchAction: 'none' }}
                  onPointerCancel={endDrag}
                  onPointerDown={startDrag(handle)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                />
              ))}
            </div>
          </div>,
          overlayElement,
        )}
      <div className={toolStyles.dock}>
        <div aria-label={t('imageViewer.tool.resize')} className={toolStyles.bar} role={'toolbar'}>
          <Select
            aria-label={t('imageViewer.resize.aspectLabel')}
            prefix={compact ? undefined : t('imageViewer.resize.aspectLabel')}
            size={'small'}
            style={{ flexShrink: 0, width: compact ? 88 : 150 }}
            value={preset}
            options={ASPECT_PRESETS.map((value) => ({
              label:
                value === 'free' || value === 'original'
                  ? t(`imageViewer.resize.aspect.${value}`)
                  : value,
              value,
            }))}
            onChange={(value) => {
              const next = value as AspectPreset;
              setPreset(next);
              setCrop(centeredCrop(natural, aspectRatioOf(next, natural)));
            }}
          />
          <span className={toolStyles.divider} />
          <Input
            aria-label={t('imageViewer.resize.width')}
            className={styles.sizeInput}
            data-compact={compact}
            inputMode={'numeric'}
            max={MAX_OUTPUT_EDGE}
            min={1}
            prefix={'W'}
            size={'small'}
            type={'number'}
            value={typing?.side === 'width' ? typing.text : output.width}
            onBlur={() => setTyping(null)}
            onChange={(event) => updateOutput('width', event.target.value)}
          />
          <ActionIcon
            active={locked}
            aria-label={t('imageViewer.resize.lock')}
            aria-pressed={locked}
            icon={locked ? LinkIcon : UnlinkIcon}
            size={'small'}
            title={t('imageViewer.resize.lock')}
            onClick={() => {
              const next = !locked;
              setLocked(next);
              if (next)
                setOutput(resolveOutputSize(cropSize, { ...output, edited: 'width' }, true));
            }}
          />
          <Input
            aria-label={t('imageViewer.resize.height')}
            className={styles.sizeInput}
            data-compact={compact}
            inputMode={'numeric'}
            max={MAX_OUTPUT_EDGE}
            min={1}
            prefix={'H'}
            size={'small'}
            type={'number'}
            value={typing?.side === 'height' ? typing.text : output.height}
            onBlur={() => setTyping(null)}
            onChange={(event) => updateOutput('height', event.target.value)}
          />
          <span className={toolStyles.divider} />
          <BarButton
            disabled={saving}
            icon={XIcon}
            label={t('imageViewer.cancel')}
            onClick={onExit}
          />
          <BarButton
            icon={SaveIcon}
            label={saving ? t('imageViewer.saving') : t('imageViewer.saveAsNew')}
            loading={saving}
            type={'primary'}
            onClick={() => void handleSave()}
          />
        </div>
      </div>
    </>
  );
};

export default ResizeMode;
