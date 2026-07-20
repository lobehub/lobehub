'use client';

import type { AcceptanceAttachment } from '@lobechat/types';
import { Flexbox, Icon, Image } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { App, Upload } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { type ClipboardEvent, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';

/** 10MB — a screenshot, not a video; keeps the reject payload light. */
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const styles = createStaticStyles(({ css }) => ({
  remove: css`
    cursor: pointer;

    position: absolute;
    z-index: 2;
    inset-block-start: -6px;
    inset-inline-end: -6px;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;

    color: #fff;

    opacity: 0;
    background: ${cssVar.colorError};

    transition: opacity 0.15s;
  `,
  thumb: css`
    position: relative;

    overflow: hidden;

    width: 56px;
    height: 56px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    &:hover .acceptance-attach-remove {
      opacity: 1;
    }

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
  thumbLoading: css`
    display: flex;
    align-items: center;
    justify-content: center;

    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

/** An attachment the user just uploaded this session — id + a live preview URL. */
export interface PendingAttachment {
  id: string;
  name?: string;
  url: string;
}

const pickImages = (files: File[]): File[] =>
  files.filter((file) => file.type.startsWith('image/'));

/**
 * Draft-attachment state for a feedback compose surface: click-to-upload and
 * paste both funnel through {@link useFileStore}'s `uploadWithProgress`, so an
 * attachment is a real file row the reject/group-feedback write references by
 * id (the same flywheel evidence uses), never a base64 blob on the note.
 */
export const useFeedbackAttachments = (max = 6) => {
  const { t } = useTranslation('verify');
  const { message } = App.useApp();
  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const images = pickImages(files);
      if (images.length === 0) return;

      const room = max - attachments.length;
      if (room <= 0) {
        message.info(t('acceptance.review.attachLimit', { count: max }));
        return;
      }

      await Promise.all(
        images.slice(0, room).map(async (file) => {
          if (file.size > MAX_ATTACHMENT_SIZE) {
            message.error(t('acceptance.review.attachTooLarge'));
            return;
          }
          setUploadingCount((count) => count + 1);
          try {
            const result = await uploadWithProgress({ file });
            if (result?.id && result.url) {
              setAttachments((previous) => [
                ...previous,
                { id: result.id, name: file.name, url: result.url },
              ]);
            }
          } catch (error) {
            console.error('[acceptance] attachment upload failed', error);
            message.error(t('acceptance.review.attachFailed'));
          } finally {
            setUploadingCount((count) => count - 1);
          }
        }),
      );
    },
    [attachments.length, max, message, t, uploadWithProgress],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const files = [...event.clipboardData.items]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length === 0) return;
      // A pasted screenshot must not also land as text in the note.
      event.preventDefault();
      void uploadFiles(files);
    },
    [uploadFiles],
  );

  const remove = useCallback(
    (id: string) => setAttachments((previous) => previous.filter((item) => item.id !== id)),
    [],
  );

  return {
    attachments,
    fileIds: attachments.map((item) => item.id),
    handlePaste,
    remove,
    uploadFiles,
    uploading: uploadingCount > 0,
  };
};

interface AttachmentStripProps {
  attachments: PendingAttachment[];
  disabled?: boolean;
  onRemove: (id: string) => void;
  uploading?: boolean;
}

/** The draft thumbnails in a compose surface — each removable, plus a spinner tile while uploading. */
export const AttachmentStrip = memo<AttachmentStripProps>(
  ({ attachments, disabled, onRemove, uploading }) => {
    if (attachments.length === 0 && !uploading) return null;
    return (
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {attachments.map((attachment) => (
          <div className={styles.thumb} key={attachment.id}>
            <Image alt={attachment.name ?? ''} preview={false} src={attachment.url} />
            {!disabled && (
              <button
                className={cx('acceptance-attach-remove', styles.remove)}
                type={'button'}
                onClick={() => onRemove(attachment.id)}
              >
                <Icon icon={X} size={12} />
              </button>
            )}
          </div>
        ))}
        {uploading && (
          <div className={cx(styles.thumb, styles.thumbLoading)}>
            <Icon spin icon={Loader2} size={16} />
          </div>
        )}
      </Flexbox>
    );
  },
);

AttachmentStrip.displayName = 'AcceptanceAttachmentStrip';

interface AttachmentUploadButtonProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/** The "attach screenshot" trigger — a picker button that hands files back for upload. */
export const AttachmentUploadButton = memo<AttachmentUploadButtonProps>(({ disabled, onFiles }) => {
  const { t } = useTranslation('verify');
  return (
    <Upload
      multiple
      accept={'image/*'}
      disabled={disabled}
      showUploadList={false}
      beforeUpload={(file, fileList) => {
        // beforeUpload fires per file — fire the batch once, on the first item.
        if (file === fileList[0]) onFiles(fileList as unknown as File[]);
        return false;
      }}
    >
      <Button disabled={disabled} icon={<Icon icon={ImagePlus} />} size={'small'} type={'text'}>
        {t('acceptance.review.attach')}
      </Button>
    </Upload>
  );
});

AttachmentUploadButton.displayName = 'AcceptanceAttachmentUploadButton';

interface AttachmentThumbsProps {
  attachments?: AcceptanceAttachment[];
}

/** Read-only screenshots on a settled feedback card — click any to zoom (native preview). */
export const AttachmentThumbs = memo<AttachmentThumbsProps>(({ attachments }) => {
  const usable = (attachments ?? []).filter((attachment) => attachment.url);
  if (usable.length === 0) return null;
  return (
    <Flexbox horizontal gap={6} wrap={'wrap'}>
      {usable.map((attachment) => (
        <div className={styles.thumb} key={attachment.id}>
          <Image alt={attachment.name ?? ''} src={attachment.url!} />
        </div>
      ))}
    </Flexbox>
  );
});

AttachmentThumbs.displayName = 'AcceptanceAttachmentThumbs';
