'use client';

import { ActionIcon, Button } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  DownloadIcon,
  MaximizeIcon,
  MinimizeIcon,
  RotateCwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MAX_ZOOM, MIN_ZOOM } from './geometry';

const styles = stylex.create({
  bar: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 3,
    insetBlockStart: '8px',
    insetInline: '8px',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  group: {
    pointerEvents: 'auto',
    display: 'flex',
    gap: '2px',
    alignItems: 'center',
    padding: '2px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowTertiary,
  },
  zoomLabel: { minWidth: '56px', paddingInline: '4px', fontVariantNumeric: 'tabular-nums' },
});

interface TopBarProps {
  /** A save is in flight; leaving now would lose its result, so Close waits. */
  closeDisabled?: boolean;
  isFullscreen: boolean;
  onClose?: () => void;
  onDownload: () => void;
  onFit: () => void;
  onRotate: () => void;
  onToggleFullscreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number;
}

const TopBar = ({
  closeDisabled,
  isFullscreen,
  onClose,
  onDownload,
  onFit,
  onRotate,
  onToggleFullscreen,
  onZoomIn,
  onZoomOut,
  zoom,
}: TopBarProps) => {
  const { t } = useTranslation('file');
  const percent = `${Math.round(zoom * 100)}%`;

  return (
    <div {...stylex.props(styles.bar)}>
      <div aria-label={t('imageViewer.zoom')} {...stylex.props(styles.group)} role={'toolbar'}>
        <ActionIcon
          aria-label={t('imageViewer.zoomOut')}
          disabled={zoom <= MIN_ZOOM}
          icon={ZoomOutIcon}
          size={'small'}
          title={t('imageViewer.zoomOut')}
          onClick={onZoomOut}
        />
        <Button
          aria-label={`${t('imageViewer.fitToScreen')} (${percent})`}
          className={stylex.props(styles.zoomLabel).className}
          size={'small'}
          title={t('imageViewer.fitToScreen')}
          type={'text'}
          onClick={onFit}
        >
          {percent}
        </Button>
        <ActionIcon
          aria-label={t('imageViewer.zoomIn')}
          disabled={zoom >= MAX_ZOOM}
          icon={ZoomInIcon}
          size={'small'}
          title={t('imageViewer.zoomIn')}
          onClick={onZoomIn}
        />
        <ActionIcon
          aria-label={t('imageViewer.rotate')}
          icon={RotateCwIcon}
          size={'small'}
          title={t('imageViewer.rotate')}
          onClick={onRotate}
        />
      </div>
      <div
        aria-label={t('imageViewer.fileActions')}
        {...stylex.props(styles.group)}
        role={'toolbar'}
      >
        <ActionIcon
          aria-label={t('imageViewer.download')}
          icon={DownloadIcon}
          size={'small'}
          title={t('imageViewer.download')}
          onClick={onDownload}
        />
        <ActionIcon
          aria-label={isFullscreen ? t('imageViewer.exitFullscreen') : t('imageViewer.fullscreen')}
          icon={isFullscreen ? MinimizeIcon : MaximizeIcon}
          size={'small'}
          title={isFullscreen ? t('imageViewer.exitFullscreen') : t('imageViewer.fullscreen')}
          onClick={onToggleFullscreen}
        />
        {(onClose || isFullscreen) && (
          <ActionIcon
            aria-label={t('imageViewer.close')}
            disabled={closeDisabled && !isFullscreen}
            icon={XIcon}
            size={'small'}
            title={t('imageViewer.close')}
            onClick={() => {
              // In browser full screen the close button leaves full screen first,
              // so the host panel is visible again before it closes.
              if (isFullscreen) {
                onToggleFullscreen();
                return;
              }
              onClose?.();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default TopBar;
