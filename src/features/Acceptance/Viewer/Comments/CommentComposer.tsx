'use client';

import { Button, Flexbox, TextArea, toast } from '@lobehub/ui';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AttachmentStrip,
  AttachmentUploadButton,
  useFeedbackAttachments,
} from '../Evidence/attachments';

/** Room for a couple of screenshots without turning a remark into an album. */
const MAX_COMMENT_ATTACHMENTS = 4;

interface CommentComposerProps {
  autoFocus?: boolean;
  /** The surrounding block draws the frame, so the field must not draw a second one. */
  borderless?: boolean;
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
  ({ autoFocus, borderless, compact, minHeight, onCancel, onSubmit, placeholder, submitLabel }) => {
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
      <Flexbox gap={8}>
        <TextArea
          autoFocus={autoFocus}
          autoSize={{ maxRows: 20, minRows: compact ? 1 : 2 }}
          placeholder={placeholder}
          // The control ships its own min-height; the floor goes on the textarea
          // itself, where an inline style outranks it.
          style={borderless ? { paddingInline: 0 } : undefined}
          styles={minHeight ? { input: { minHeight } } : undefined}
          value={value}
          variant={borderless ? 'borderless' : undefined}
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
