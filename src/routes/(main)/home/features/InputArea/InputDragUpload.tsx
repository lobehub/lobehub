'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { FileImage, FileText, FileUpIcon } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDragUploadContext } from '@/components/DragUploadZone/DragUploadProvider';
import { useLocalDragUpload } from '@/components/DragUploadZone/useLocalDragUpload';

const BLOCK_SIZE = 30;
const ICON_SIZE = { size: 18, strokeWidth: 1.5 };
// The dashed outline sits this far inside the overlay edge.
const BORDER_INSET = 8;
const OVERLAY_ICONS = [FileImage, FileUpIcon, FileText];

const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
  `,
  desc: css`
    max-width: 320px;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
  `,
  icon: css`
    border-radius: ${cssVar.borderRadiusSM};
  `,
  overlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 100;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    /* A gray translucent "filled" layer laid over the input — it fills the exact
       input box, so its width/height always match. A dashed outline sits inside
       the edge to signal the drop target. */
    background: color-mix(in srgb, ${cssVar.colorBgElevated} 74%, transparent);

    &::before {
      pointer-events: none;
      content: '';

      position: absolute;
      inset: ${BORDER_INSET}px;

      border: 1.5px dashed ${cssVar.colorTextTertiary};
      border-radius: 12px;
    }
  `,
  title: css`
    font-size: 14px;
    font-weight: bold;
    color: ${cssVar.colorText};
  `,
}));

interface InputDragUploadProps {
  children: ReactNode;
  onUploadFiles: (files: File[]) => void | Promise<void>;
  /** Corner radius to match the wrapped input (default matches the composer). */
  radius?: number;
  style?: CSSProperties;
}

/**
 * Home composer drag-upload overlay. Unlike the shared `DragUploadZone` (a
 * floating card centered in whatever area it wraps), this overlay fills the
 * input's exact bounds with a gray translucent `filled` layer + dashed outline,
 * so it reads as the input itself lighting up as a drop target.
 */
const InputDragUpload = memo<InputDragUploadProps>(
  ({ children, onUploadFiles, radius = 20, style }) => {
    const { t } = useTranslation('components');
    const { isDraggingGlobally } = useDragUploadContext();
    const { getContainerProps } = useLocalDragUpload({ onUploadFiles });

    return (
      <div className={styles.container} style={style} {...getContainerProps()}>
        {children}
        {isDraggingGlobally && (
          <div className={styles.overlay} style={{ borderRadius: radius }}>
            <Center gap={8}>
              <Flexbox horizontal>
                <Center
                  className={styles.icon}
                  height={BLOCK_SIZE * 1.2}
                  width={BLOCK_SIZE}
                  style={{
                    background: cssVar.colorFillSecondary,
                    color: cssVar.colorTextSecondary,
                    transform: 'rotateZ(-20deg) translateX(8px)',
                  }}
                >
                  <Icon icon={OVERLAY_ICONS[0]} size={ICON_SIZE} />
                </Center>
                <Center
                  className={styles.icon}
                  height={BLOCK_SIZE * 1.2}
                  width={BLOCK_SIZE}
                  style={{
                    background: cssVar.colorFill,
                    color: cssVar.colorText,
                    transform: 'translateY(-8px)',
                    zIndex: 1,
                  }}
                >
                  <Icon icon={OVERLAY_ICONS[1]} size={ICON_SIZE} />
                </Center>
                <Center
                  className={styles.icon}
                  height={BLOCK_SIZE * 1.2}
                  width={BLOCK_SIZE}
                  style={{
                    background: cssVar.colorFillSecondary,
                    color: cssVar.colorTextSecondary,
                    transform: 'rotateZ(20deg) translateX(-8px)',
                  }}
                >
                  <Icon icon={OVERLAY_ICONS[2]} size={ICON_SIZE} />
                </Center>
              </Flexbox>
              <Flexbox align={'center'} gap={4}>
                <div className={styles.title}>{t('DragUpload.dragFileTitle')}</div>
                <div className={styles.desc}>{t('DragUpload.dragFileDesc')}</div>
              </Flexbox>
            </Center>
          </div>
        )}
      </div>
    );
  },
);

InputDragUpload.displayName = 'InputDragUpload';

export default InputDragUpload;
