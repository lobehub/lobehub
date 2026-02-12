'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { FileImage, FileText, FileUpIcon } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDragUploadContext } from './DragUploadProvider';
import { useLocalDragUpload } from './useLocalDragUpload';

const BLOCK_SIZE = 48;
const ICON_SIZE = { size: 28, strokeWidth: 1.5 };

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
  `,
  content: css`
    width: 100%;
    height: 100%;
    padding: 12px;
    border: 1.5px dashed #fff;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  desc: css`
    font-size: 12px;
    line-height: 18px;
    color: #fff;
  `,
  icon: css`
    border-radius: ${cssVar.borderRadiusSM};
    color: color-mix(in srgb, ${cssVar.geekblue} 95%, black);
    background: color-mix(in srgb, ${cssVar.geekblue} 38%, white);
  `,
  iconGroup: css`
    margin-block-start: -32px;
  `,
  overlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 100;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgMask};

    transition: all 0.2s ease-in-out;
  `,
  overlayContent: css`
    padding: ${cssVar.borderRadiusLG};
    border-radius: 12px;
    background: ${cssVar.geekblue};
  `,
  title: css`
    font-size: 16px;
    font-weight: bold;
    color: #fff;
  `,
}));

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
    overlayMinHeight = 160,
    onUploadFiles,
    style,
  }) => {
    const { t } = useTranslation('components');

    // Global drag state - shows overlay when dragging anywhere on page
    const { isDraggingGlobally } = useDragUploadContext();

    // Local drop handler - only handles drop events
    const { getContainerProps } = useLocalDragUpload({
      disabled,
      onUploadFiles,
    });

    // Show overlay when files are being dragged anywhere on the page
    const showOverlay = isDraggingGlobally && !disabled;

    return (
      <div className={cx(styles.container, className)} style={style} {...getContainerProps()}>
        {children}
        {showOverlay && (
          <div className={styles.overlay}>
            <div className={styles.overlayContent} style={{ minHeight: overlayMinHeight }}>
              <Center className={styles.content} gap={8}>
                <Flexbox horizontal className={styles.iconGroup}>
                  <Center
                    className={styles.icon}
                    height={BLOCK_SIZE * 1.2}
                    width={BLOCK_SIZE}
                    style={{
                      background: `color-mix(in srgb, ${cssVar.geekblue} 68%, white)`,
                      transform: 'rotateZ(-20deg) translateX(8px)',
                    }}
                  >
                    <Icon icon={FileImage} size={ICON_SIZE} />
                  </Center>
                  <Center
                    className={styles.icon}
                    height={BLOCK_SIZE * 1.2}
                    width={BLOCK_SIZE}
                    style={{
                      transform: 'translateY(-10px)',
                      zIndex: 1,
                    }}
                  >
                    <Icon icon={FileUpIcon} size={ICON_SIZE} />
                  </Center>
                  <Center
                    className={styles.icon}
                    height={BLOCK_SIZE * 1.2}
                    width={BLOCK_SIZE}
                    style={{
                      background: `color-mix(in srgb, ${cssVar.geekblue} 68%, white)`,
                      transform: 'rotateZ(20deg) translateX(-8px)',
                    }}
                  >
                    <Icon icon={FileText} size={ICON_SIZE} />
                  </Center>
                </Flexbox>
                <Flexbox align={'center'} gap={4} style={{ textAlign: 'center' }}>
                  <Flexbox className={styles.title}>
                    {t(enabledFiles ? 'DragUpload.dragFileTitle' : 'DragUpload.dragTitle')}
                  </Flexbox>
                  <Flexbox className={styles.desc}>
                    {t(enabledFiles ? 'DragUpload.dragFileDesc' : 'DragUpload.dragDesc')}
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

export { usePasteFile } from './usePasteFile';
export { useUploadFiles } from './useUploadFiles';
export default DragUploadZone;
