'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileImage, FileText, FileUpIcon, FolderIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useDragUploadContext } from './DragUploadProvider';
import { type DroppedLocalPath, useLocalDragUpload } from './useLocalDragUpload';

const BLOCK_SIZE = 48;
const ICON_SIZE = { size: 28, strokeWidth: 1.5 };
const OVERLAY_INSET = 28;
const OVERLAY_BORDER_INSET = 10;

const DEFAULT_TONE = {
  iconColor: `color-mix(in srgb, ${cssVar.geekblue} 95%, black)`,
  iconStrongBg: `color-mix(in srgb, ${cssVar.geekblue} 38%, white)`,
  iconSoftBg: `color-mix(in srgb, ${cssVar.geekblue} 68%, white)`,
};

const LOCAL_PATH_TONE = {
  iconColor: `color-mix(in srgb, ${cssVar.purple} 82%, black)`,
  iconStrongBg: `color-mix(in srgb, ${cssVar.purple} 36%, white)`,
  iconSoftBg: `color-mix(in srgb, ${cssVar.purple} 64%, white)`,
};

const styles = stylex.create({
  container: { position: 'relative' },
  content: {
    position: 'relative',
    zIndex: 1,
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    paddingBlock: '24px',
    paddingInline: '28px',
  },
  desc: { fontSize: '12px', lineHeight: '18px', color: '#fff' },
  icon: { borderRadius: cssVar.borderRadiusSM },
  iconGroup: { marginBlockStart: '0' },
  overlay: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 100,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    transition: 'all 0.2s ease-in-out',
  },
  overlayContent: {
    'position': 'relative',
    'boxSizing': 'border-box',
    'width': 'min(460px, 72vw)',
    'padding': `${OVERLAY_INSET}px`,
    'borderRadius': '16px',
    'backgroundColor': cssVar.geekblue,
    'backgroundImage': 'none',
    'boxShadow': `0 16px 48px color-mix(in srgb, ${cssVar.geekblue} 32%, transparent)`,
    '::before': {
      pointerEvents: 'none',
      content: '""',
      position: 'absolute',
      inset: `${OVERLAY_BORDER_INSET}px`,
      borderWidth: '1.5px',
      borderStyle: 'dashed',
      borderColor: '#fff',
      borderRadius: cssVar.borderRadiusLG,
    },
  },
  overlayContentLocalPath: {
    backgroundColor: `color-mix(in srgb, ${cssVar.purple} 82%, ${cssVar.geekblue})`,
    backgroundImage: 'none',
    boxShadow: `0 16px 48px color-mix(in srgb, ${cssVar.purple} 32%, transparent)`,
  },
  title: { fontSize: '16px', fontWeight: 'bold', color: '#fff' },
});

export interface DragUploadZoneProps {
  /**
   * The content to render inside the drop zone
   */
  children: ReactNode;
  /**
   * Custom class name for the container
   */
  className?: string;
  /**
   * Whether the drop zone is disabled
   */
  disabled?: boolean;
  /**
   * Whether to show file types (images + documents) or just images
   * @default true
   */
  enabledFiles?: boolean;
  /**
   * Whether dropping local files/folders should insert their filesystem paths
   * into the chat input instead of uploading them. Requires Electron (uses
   * webUtils to resolve paths). Unresolved items fall back to upload.
   */
  enableLocalPathReference?: boolean;
  /**
   * Callback when top-level local files/folders are dropped and local path
   * reference mode is on.
   */
  onLocalPaths?: (paths: DroppedLocalPath[]) => void | Promise<void>;
  /**
   * Callback when files are dropped
   */
  onUploadFiles: (files: File[]) => void | Promise<void>;
  /**
   * Minimum height of the overlay content
   */
  overlayMinHeight?: number;
  /**
   * Custom style for the container
   */
  style?: CSSProperties;
}

const DragUploadZone = memo<DragUploadZoneProps>(
  ({
    children,
    className,
    disabled = false,
    enabledFiles = true,
    enableLocalPathReference = false,
    onLocalPaths,
    overlayMinHeight = 160,
    onUploadFiles,
    style,
  }) => {
    const { t } = useTranslation('components');

    // Global drag state - shows overlay when dragging anywhere on page
    const { isDraggingGlobally, dragContentKind } = useDragUploadContext();

    // Local drop handler - only handles drop events
    const { getContainerProps } = useLocalDragUpload({
      disabled,
      enableLocalPathReference,
      onLocalPaths,
      onUploadFiles,
    });

    // Show overlay when files are being dragged anywhere on the page
    const showOverlay = isDraggingGlobally && !disabled;
    const isLocalPathReferenceOverlay = enableLocalPathReference && dragContentKind !== 'none';

    // Local path reference mode has distinct copy and tone so users can tell it
    // will insert filesystem references rather than upload files.
    const overlayCopy = useMemo(() => {
      if (isLocalPathReferenceOverlay) {
        return {
          desc: t('DragUpload.dragLocalPathDesc'),
          showFolderIcon: dragContentKind === 'folders',
          title: t('DragUpload.dragLocalPathTitle'),
        };
      }
      if (dragContentKind === 'folders') {
        return {
          desc: t('DragUpload.dragFolderDesc'),
          showFolderIcon: true,
          title: t('DragUpload.dragFolderTitle'),
        };
      }
      if (dragContentKind === 'mixed') {
        return {
          desc: t('DragUpload.dragMixedDesc'),
          showFolderIcon: true,
          title: t('DragUpload.dragMixedTitle'),
        };
      }
      return {
        desc: t(enabledFiles ? 'DragUpload.dragFileDesc' : 'DragUpload.dragDesc'),
        showFolderIcon: false,
        title: t(enabledFiles ? 'DragUpload.dragFileTitle' : 'DragUpload.dragTitle'),
      };
    }, [dragContentKind, enabledFiles, isLocalPathReferenceOverlay, t]);

    const overlayIcons = useMemo(() => {
      if (isLocalPathReferenceOverlay && dragContentKind === 'mixed') {
        return [FolderIcon, FileUpIcon, FileText];
      }
      if (overlayCopy.showFolderIcon) return [FolderIcon, FolderIcon, FolderIcon];
      return [FileImage, FileUpIcon, FileText];
    }, [dragContentKind, isLocalPathReferenceOverlay, overlayCopy.showFolderIcon]);
    const tone = isLocalPathReferenceOverlay ? LOCAL_PATH_TONE : DEFAULT_TONE;

    return (
      <div {...sx([styles.container], className, style)} {...getContainerProps()}>
        {children}
        {showOverlay && (
          <div {...stylex.props(styles.overlay)}>
            <div
              {...sx(
                [
                  styles.overlayContent,
                  isLocalPathReferenceOverlay && styles.overlayContentLocalPath,
                ],
                undefined,
                { minHeight: overlayMinHeight },
              )}
            >
              <Center className={stylex.props(styles.content).className} gap={8}>
                <Flexbox horizontal className={stylex.props(styles.iconGroup).className}>
                  <Center
                    className={stylex.props(styles.icon).className}
                    height={BLOCK_SIZE * 1.2}
                    width={BLOCK_SIZE}
                    style={{
                      background: tone.iconSoftBg,
                      color: tone.iconColor,
                      transform: 'rotateZ(-20deg) translateX(8px)',
                    }}
                  >
                    <Icon icon={overlayIcons[0]} size={ICON_SIZE} />
                  </Center>
                  <Center
                    className={stylex.props(styles.icon).className}
                    height={BLOCK_SIZE * 1.2}
                    width={BLOCK_SIZE}
                    style={{
                      background: tone.iconStrongBg,
                      color: tone.iconColor,
                      transform: 'translateY(-10px)',
                      zIndex: 1,
                    }}
                  >
                    <Icon icon={overlayIcons[1]} size={ICON_SIZE} />
                  </Center>
                  <Center
                    className={stylex.props(styles.icon).className}
                    height={BLOCK_SIZE * 1.2}
                    width={BLOCK_SIZE}
                    style={{
                      background: tone.iconSoftBg,
                      color: tone.iconColor,
                      transform: 'rotateZ(20deg) translateX(-8px)',
                    }}
                  >
                    <Icon icon={overlayIcons[2]} size={ICON_SIZE} />
                  </Center>
                </Flexbox>
                <Flexbox align={'center'} gap={4} style={{ textAlign: 'center' }}>
                  <Flexbox className={stylex.props(styles.title).className}>
                    {overlayCopy.title}
                  </Flexbox>
                  <Flexbox className={stylex.props(styles.desc).className}>
                    {overlayCopy.desc}
                  </Flexbox>
                </Flexbox>
              </Center>
            </div>
          </div>
        )}
      </div>
    );
  },
);

DragUploadZone.displayName = 'DragUploadZone';

export type { DroppedLocalPath } from './useLocalDragUpload';
export { usePasteFile } from './usePasteFile';
export { useUploadFiles } from './useUploadFiles';
export default DragUploadZone;
