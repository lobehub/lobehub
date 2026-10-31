'use client';

import type { AcceptanceAttachment } from '@lobechat/types';
import { Button, Flexbox, Icon, Image, Spin, toast, Upload, useResponsive } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ImagePlus, X } from 'lucide-react';
import { type ClipboardEvent, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';
import { sx } from '@/styles/sx';

import moduleStyles from './attachments.module.css';

/** 10MB — a screenshot, not a video; keeps the reject payload light. */
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const coarseOrCompact = '@media (pointer: coarse), (width <= 767px)';

const styles = stylex.create({
  flushUpload: {
    display: 'contents',
  },
  remove: {
    cursor: 'pointer',
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: 0,
    insetInlineEnd: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: { default: '28px', [coarseOrCompact]: '44px' },
    height: { default: '28px', [coarseOrCompact]: '44px' },
    padding: 0,
    borderStyle: 'none',
    borderRadius: '50%',
    color: '#fff',
    opacity: 1,
    backgroundColor: cssVar.colorError,
    backgroundImage: 'none',
    transition: 'opacity 0.15s',
  },
  thumb: {
    position: 'relative',
    overflow: 'hidden',
    width: '56px',
    height: '56px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
  },
  // A screenshot posted INTO a remark is the remark's evidence, not a chip on a
  // draft: at 56px "here is what I see instead" is unreadable, so in a comment
  // the picture is shown at a size a reader can judge without opening it.
  thumbLarge: {
    width: 'auto',
    maxWidth: 'min(100%, 360px)',
    height: 'auto',
    maxHeight: '220px',
  },
  thumbLoading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

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
export const useFeedbackAttachments = (max = 6, initialAttachments: PendingAttachment[] = []) => {
  const { t } = useTranslation('verify');

  const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
  const [attachments, setAttachments] = useState<PendingAttachment[]>(initialAttachments);
  const [uploadingCount, setUploadingCount] = useState(0);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const images = pickImages(files);
      if (images.length === 0) return;

      const room = max - attachments.length;
      if (room <= 0) {
        toast.info(t('acceptance.review.attachLimit', { count: max }));
        return;
      }

      await Promise.all(
        images.slice(0, room).map(async (file) => {
          if (file.size > MAX_ATTACHMENT_SIZE) {
            toast.error(t('acceptance.review.attachTooLarge'));
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
            toast.error(t('acceptance.review.attachFailed'));
          } finally {
            setUploadingCount((count) => count - 1);
          }
        }),
      );
    },
    [attachments.length, max, t, uploadWithProgress],
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
    const { t } = useTranslation('verify');
    if (attachments.length === 0 && !uploading) return null;
    return (
      <Flexbox horizontal gap={8} wrap={'wrap'}>
        {attachments.map((attachment) => (
          <div key={attachment.id} {...sx([styles.thumb], moduleStyles.thumb)}>
            <Image alt={attachment.name ?? ''} preview={false} src={attachment.url} />
            {!disabled && (
              <button
                aria-label={t('acceptance.review.removeAttachment')}
                type={'button'}
                {...stylex.props(styles.remove)}
                onClick={() => onRemove(attachment.id)}
              >
                <Icon icon={X} size={12} />
              </button>
            )}
          </div>
        ))}
        {uploading && (
          <div {...sx([styles.thumb, styles.thumbLoading], moduleStyles.thumb)}>
            <Spin size="small" />
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
  // A 44px target is for thumbs; on a pointer device it towers over the field above it.
  const { md = true } = useResponsive();
  return (
    <Upload
      multiple
      accept={'image/*'}
      {...stylex.props(styles.flushUpload)}
      disabled={disabled}
      onFiles={onFiles}
    >
      <Button
        outdent
        disabled={disabled}
        icon={<Icon icon={ImagePlus} />}
        style={{ alignSelf: 'flex-start', minHeight: md ? undefined : 44 }}
        type={'text'}
      >
        {t('acceptance.review.attach')}
      </Button>
    </Upload>
  );
});

AttachmentUploadButton.displayName = 'AcceptanceAttachmentUploadButton';

interface AttachmentThumbsProps {
  attachments?: AcceptanceAttachment[];
  /** `comment` shows the picture at reading size; the default is the 56px chip. */
  size?: 'chip' | 'comment';
}

/** Read-only screenshots on a settled feedback card — click any to zoom (native preview). */
export const AttachmentThumbs = memo<AttachmentThumbsProps>(({ attachments, size = 'chip' }) => {
  const usable = (attachments ?? []).filter((attachment) => attachment.url);
  if (usable.length === 0) return null;
  return (
    // Every host row is itself clickable (jump to the check), and that jump closes the
    // drawer this list often lives in — which would unmount the zoom viewer in the same
    // tick it opened. Zooming a thumbnail is its own action, so it stops here.
    <Flexbox
      horizontal
      gap={6}
      wrap={'wrap'}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {usable.map((attachment) => (
        <div
          key={attachment.id}
          {...sx(
            [styles.thumb, size === 'comment' && styles.thumbLarge],
            size === 'comment'
              ? `${moduleStyles.thumb} ${moduleStyles.thumbLarge}`
              : moduleStyles.thumb,
          )}
        >
          <Image alt={attachment.name ?? ''} src={attachment.url!} />
        </div>
      ))}
    </Flexbox>
  );
});

AttachmentThumbs.displayName = 'AcceptanceAttachmentThumbs';
