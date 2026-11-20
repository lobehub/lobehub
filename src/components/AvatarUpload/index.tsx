'use client';

import { Avatar, Icon, Spin, Upload } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PencilIcon, X } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';

import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

// Image-only avatar control (Upload + square-crop + pencil hover overlay).
// Use when an avatar must come from an uploaded image rather than an emoji.
interface AvatarUploadProps {
  /** Show the hover delete badge (i.e. a real avatar is set). */
  allowDelete?: boolean;
  compressSize?: number;
  loading?: boolean;
  onDelete?: () => void;
  onUpload?: (file: File) => void;
  /** Rendered in place of the letter-avatar while no image is set. */
  placeholder?: ReactNode;
  shape?: 'circle' | 'square';
  size?: number;
  title?: string;
  /** Image URL, or a name string for the generated letter-avatar preview. */
  value?: string;
}

const styles = stylex.create({
  delete: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: '2px',
    insetInlineEnd: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBgContainer,
    borderRadius: '50%',
    color: cssVar.colorTextLightSolid,
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
    transition: `opacity ${cssVar.motionDurationMid} ease`,
  },
  overlay: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    transition: `opacity ${cssVar.motionDurationMid} ease`,
  },
  wrapper: {
    cursor: 'pointer',
    position: 'relative',
    flex: 'none',
    borderRadius: '8px',
  },
});

const AvatarUpload = memo<AvatarUploadProps>(
  ({
    value,
    onUpload,
    onDelete,
    allowDelete,
    loading,
    compressSize = 256,
    shape = 'square',
    placeholder,
    size = 72,
    title,
  }) => {
    const handleUpload = useMemo(
      () =>
        createUploadImageHandler(async (dataUrl) => {
          const img = new Image();
          img.src = dataUrl;
          await new Promise((resolve, reject) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', reject);
          });
          const webpBase64 = imageToBase64({ img, size: compressSize });
          const blob = await (await fetch(webpBase64)).blob();
          onUpload?.(new File([blob], 'avatar.webp', { type: 'image/webp' }));
        }),
      [compressSize, onUpload],
    );

    return (
      <Upload maxCount={1} onFiles={([file]) => handleUpload(file)}>
        <Spin size="small" spinning={!!loading}>
          <div {...stylex.props(styles.wrapper, stylex.defaultMarker())}>
            <Avatar avatar={value || placeholder} shape={shape} size={size} title={title} />
            <div {...stylex.props(styles.overlay)}>
              <Icon
                color={cssVar.colorTextLightSolid}
                icon={PencilIcon}
                size={Math.round(size / 3)}
              />
            </div>
            {allowDelete && (
              <div
                {...stylex.props(styles.delete)}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete?.();
                }}
              >
                <Icon icon={X} size={12} />
              </div>
            )}
          </div>
        </Spin>
      </Upload>
    );
  },
);

AvatarUpload.displayName = 'AvatarUpload';

export default AvatarUpload;
