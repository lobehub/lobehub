'use client';

import { Center, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileImage, FileText, FileUpIcon } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useDragUploadContext } from '@/components/DragUploadZone/DragUploadProvider';
import { useLocalDragUpload } from '@/components/DragUploadZone/useLocalDragUpload';

const BLOCK_SIZE = 32;
const ICON_SIZE = { size: 18, strokeWidth: 1.5 };
// The dashed outline sits this far inside the overlay edge.
const BORDER_INSET = 8;
const OVERLAY_ICONS = [FileImage, FileUpIcon, FileText];

const styles = stylex.create({
  container: { position: 'relative' },
  desc: {
    maxWidth: '320px',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextSecondary,
    textAlign: 'center',
  },
  icon: {
    flex: 'none',
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
  overlay: {
    'pointerEvents': 'none',
    'position': 'absolute',
    'zIndex': 100,
    'inset': '0',
    'display': 'flex',
    'alignItems': 'center',
    'justifyContent': 'center',
    'backgroundColor': cssVar.colorBgElevated,
    'backgroundImage': 'none',
    '::before': {
      pointerEvents: 'none',
      content: "''",
      position: 'absolute',
      inset: `${BORDER_INSET}px`,
      borderWidth: '1px',
      borderStyle: 'dashed',
      borderColor: cssVar.colorTextTertiary,
      borderRadius: '12px',
    },
  },
});

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
      <div
        className={stylex.props(styles.container).className}
        style={style}
        {...getContainerProps()}
      >
        {children}
        {isDraggingGlobally && (
          <div className={stylex.props(styles.overlay).className} style={{ borderRadius: radius }}>
            <Center gap={10}>
              <Flexbox horizontal gap={8}>
                {OVERLAY_ICONS.map((IconComp, i) => (
                  <Center
                    className={stylex.props(styles.icon).className}
                    height={BLOCK_SIZE}
                    key={i}
                    width={BLOCK_SIZE}
                  >
                    <Icon icon={IconComp} size={ICON_SIZE} />
                  </Center>
                ))}
              </Flexbox>
              <div {...stylex.props(styles.desc)}>{t('DragUpload.dragFileDesc')}</div>
            </Center>
          </div>
        )}
      </div>
    );
  },
);

InputDragUpload.displayName = 'InputDragUpload';

export default InputDragUpload;
