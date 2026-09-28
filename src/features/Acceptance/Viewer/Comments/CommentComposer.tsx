'use client';

import { Flexbox, TextArea } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { CSSProperties } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AttachmentStrip,
  AttachmentUploadButton,
  useFeedbackAttachments,
} from '../Evidence/attachments';

/**
 * `autoSize` writes its own inline height onto the textarea, so a floor has to
 * reach the element itself — a `style` on the component lands on the wrapper.
 */
const styles = createStaticStyles(({ css }) => ({
  tall: css`
    & textarea {
      /* The control ships its own min-height; this floor has to outrank it. */
      min-height: var(--acceptance-composer-min-height) !important;
    }
  `,
}));

/** Room for a couple of screenshots without turning a remark into an album. */
const MAX_COMMENT_ATTACHMENTS = 4;

interface CommentComposerProps {
  autoFocus?: boolean;
  /** One-line reply box instead of the two-line root box. */
  compact?: boolean;
  /**
   * Floor for the writing area. The delivery-wide box gets a generous one: a
   * two-line field invites a two-word answer, and this is where the round's
   * real objection gets written.
   */
  minHeight?: number;
  onCancel?: () => void;
  /** Resolve when the comment is persisted; the box clears on success. */
  onSubmit: (content: string, attachments: { fileId: string }[]) => Promise<void>;
  placeholder: string;
  submitLabel?: string;
}

/**
 * A plain-text box with a send button and room for screenshots. Comments here
 * are short remarks between two people looking at the same evidence, and the
 * commonest one is "here is what I see instead" — so a picture is a first-class
 * part of the remark rather than something pasted into the prose. ⌘/Ctrl+Enter
 * sends.
 */
const CommentComposer = memo<CommentComposerProps>(
  ({ autoFocus, compact, minHeight, onCancel, onSubmit, placeholder, submitLabel }) => {
    const { t } = useTranslation('verify');
    const [value, setValue] = useState('');
    const [sending, setSending] = useState(false);
    const { attachments, fileIds, handlePaste, remove, uploadFiles, uploading } =
      useFeedbackAttachments(MAX_COMMENT_ATTACHMENTS);
    const trimmed = value.trim();
    // A screenshot on its own is a complete remark.
    const canSend = (trimmed.length > 0 || fileIds.length > 0) && !uploading;

    const submit = async () => {
      if (!canSend || sending) return;
      setSending(true);
      try {
        await onSubmit(
          trimmed,
          fileIds.map((fileId) => ({ fileId })),
        );
        setValue('');
        for (const id of fileIds) remove(id);
      } catch (cause) {
        console.error('[acceptance:comments]', cause);
        toast.error(t('acceptance.comments.createFailed'));
      } finally {
        setSending(false);
      }
    };

    return (
      <Flexbox
        className={minHeight ? styles.tall : undefined}
        gap={8}
        style={
          minHeight
            ? ({ '--acceptance-composer-min-height': `${minHeight}px` } as CSSProperties)
            : undefined
        }
      >
        <TextArea
          autoFocus={autoFocus}
          autoSize={{ maxRows: 20, minRows: compact ? 1 : 2 }}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <AttachmentStrip
          attachments={attachments}
          disabled={sending}
          uploading={uploading}
          onRemove={remove}
        />
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <AttachmentUploadButton disabled={sending} onFiles={uploadFiles} />
          <Flexbox flex={1} />
          {onCancel && (
            <Button size={'small'} type={'text'} onClick={onCancel}>
              {t('cancel', { ns: 'common' })}
            </Button>
          )}
          <Button
            disabled={!canSend}
            loading={sending}
            size={'small'}
            type={'primary'}
            onClick={() => void submit()}
          >
            {submitLabel ?? t('acceptance.comments.send')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  },
);

CommentComposer.displayName = 'AcceptanceCommentComposer';

export default CommentComposer;
