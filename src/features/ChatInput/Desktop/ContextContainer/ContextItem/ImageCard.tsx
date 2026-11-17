import { ActionIcon, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlertIcon, RotateCwIcon, XIcon } from 'lucide-react';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';
import { useChatInputUploadKey } from '@/features/ChatInput/hooks/useChatInputUpload';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files/upload';

import { openFilePreviewModal } from './FilePreviewModal.loader';
import UploadIndicator from './UploadIndicator';
import UploadTooltipContent from './UploadTooltipContent';
import { useRepastePulse } from './useRepastePulse';
import { getUploadChipState } from './utils';

const IMAGE_CARD_SIZE = 112;

const styles = stylex.create({
  card: {
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    width: `${IMAGE_CARD_SIZE}px`,
    height: `${IMAGE_CARD_SIZE}px`,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  cardError: { borderColor: cssVar.colorErrorBorder },
  image: {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewButton: {
    cursor: 'zoom-in',
    position: 'absolute',
    inset: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  close: {
    cursor: 'pointer',
    position: 'absolute',
    insetBlockStart: '4px',
    insetInlineEnd: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '50%',
    color: {
      'default': cssVar.colorTextSecondary,
      ':hover': cssVar.colorText,
    },
    backgroundColor: cssVar.colorBgElevated,
    boxShadow: cssVar.boxShadowTertiary,
  },
  overlay: {
    pointerEvents: 'none',
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `color-mix(in srgb, ${cssVar.colorBgContainer} 60%, transparent)`,
  },
  overlayActions: { pointerEvents: 'auto' },
});

const ImageCard = memo<UploadFileItem>((item) => {
  const { errorCode, file, id, previewUrl } = item;
  const { t } = useTranslation(['chat', 'common']);
  const contextKey = useChatInputUploadKey();
  const removeChatUploadFile = useFileStore((s) => s.removeChatUploadFile);
  const retryChatUploadFile = useFileStore((s) => s.retryChatUploadFile);
  const { busy, canRetry, indicator } = getUploadChipState(item);
  const src = previewUrl || item.fileUrl || item.base64Url;
  const cardRef = useRef<HTMLDivElement>(null);
  useRepastePulse(cardRef, item.repastedAt);

  const handlePreview = useEventCallback(() => {
    void openFilePreviewModal(item);
  });
  const handleRemove = useEventCallback(() => {
    if (contextKey) void removeChatUploadFile(contextKey, id);
  });
  const handleRetry = useEventCallback(() => {
    if (contextKey) void retryChatUploadFile(contextKey, id);
  });

  return (
    <div
      aria-busy={busy}
      ref={cardRef}
      {...stylex.props(styles.card, canRetry && styles.cardError)}
    >
      {src && <img alt={file.name} draggable={false} src={src} {...stylex.props(styles.image)} />}
      <Tooltip title={<UploadTooltipContent {...item} />}>
        <button
          aria-label={t('upload.image.preview', { name: file.name })}
          disabled={!src}
          type={'button'}
          onClick={handlePreview}
          {...stylex.props(styles.previewButton)}
        />
      </Tooltip>
      {(busy || canRetry) && (
        <div {...stylex.props(styles.overlay)}>
          {indicator === 'busy' ? (
            <UploadIndicator label={t('upload.preview.status.uploading')} size={24} />
          ) : (
            <>
              <Icon
                aria-label={t('upload.preview.status.error')}
                icon={CircleAlertIcon}
                size={20}
                style={{ color: cssVar.colorError }}
              />
              <div {...stylex.props(styles.overlayActions)}>
                {errorCode ? (
                  <FileUploadErrorActions compact code={errorCode} />
                ) : (
                  <ActionIcon
                    icon={RotateCwIcon}
                    size={'small'}
                    title={t('retry', { ns: 'common' })}
                    onClick={handleRetry}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
      <button
        aria-label={t('upload.image.remove', { name: file.name })}
        type={'button'}
        onClick={handleRemove}
        {...stylex.props(styles.close)}
      >
        <Icon icon={XIcon} size={12} />
      </button>
    </div>
  );
});

ImageCard.displayName = 'ImageCard';

export default ImageCard;
