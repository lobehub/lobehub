'use client';

import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
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

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    pointer-events: none;

    position: absolute;
    z-index: 3;
    inset-block-start: 8px;
    inset-inline: 8px;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  `,
  group: css`
    pointer-events: auto;

    display: flex;
    gap: 2px;
    align-items: center;

    padding: 2px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  zoomLabel: css`
    min-width: 56px;
    padding-inline: 4px;
    font-variant-numeric: tabular-nums;
  `,
}));

interface TopBarProps {
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
    <div className={styles.bar}>
      <div aria-label={t('imageViewer.zoom')} className={styles.group} role={'toolbar'}>
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
          className={styles.zoomLabel}
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
      <div aria-label={t('imageViewer.fileActions')} className={styles.group} role={'toolbar'}>
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
