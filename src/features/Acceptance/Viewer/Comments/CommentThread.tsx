'use client';

import type { AcceptanceCommentThread } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Tag, toast } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { CheckCircle2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CommentCard, { commentAuthorName } from './CommentCard';
import CommentComposer from './CommentComposer';
import { styles } from './styles';

interface CommentThreadProps {
  canComment: boolean;
  /**
   * Whether closing THIS thread is the caller's to make. Replying is open to
   * every reader; declaring a concern handled belongs to whoever raised it and
   * to the delivery's reviewers.
   */
  canResolve: boolean;
  onDelete: (id: string) => Promise<void>;
  onReply: (rootId: string, content: string, attachments: { fileId: string }[]) => Promise<void>;
  onResolve: (rootId: string, resolved: boolean) => Promise<void>;
  thread: AcceptanceCommentThread;
}

/**
 * A region note and its answers, as the floating pin shows them: the remark,
 * whoever replied, and the two things you can do about it. Frameless on
 * purpose — the panel it lives in is already a surface.
 *
 * Once it is settled it folds to a single muted line. A handled concern is
 * closed business: it should be findable, not loud, which is why nothing here
 * carries a success colour any more.
 */
const CommentThread = memo<CommentThreadProps>(
  ({ canComment, canResolve, onDelete, onReply, onResolve, thread }) => {
    const { t } = useTranslation('verify');
    const [replying, setReplying] = useState(false);
    const [resolving, setResolving] = useState(false);
    const [openOverride, setOpenOverride] = useState<boolean>();
    const { root, replies } = thread;
    const resolved = Boolean(root.resolvedAt);
    // Reopening a note should show it again without the reader asking twice,
    // so the override only holds while the resolved state stays put.
    const open = openOverride ?? !resolved;

    const toggleResolved = async () => {
      setResolving(true);
      try {
        await onResolve(root.id, !resolved);
        setOpenOverride(undefined);
      } catch (cause) {
        console.error('[acceptance:comments]', cause);
        toast.error(t('acceptance.comments.updateFailed'));
      } finally {
        setResolving(false);
      }
    };

    if (!open)
      return (
        <button
          className={styles.resolvedSummary}
          type={'button'}
          onClick={() => setOpenOverride(true)}
        >
          <Flexbox horizontal align={'center'} gap={6}>
            <Icon icon={CheckCircle2} size={13} />
            <span>
              {t('acceptance.comments.resolvedSummary', {
                count: replies.length + 1,
                name: commentAuthorName(root.author),
              })}
            </span>
          </Flexbox>
        </button>
      );

    const badges = root.contextRoundIndex !== null && (
      <Tag size={'small'}>
        {t('acceptance.comments.roundContext', { round: root.contextRoundIndex })}
      </Tag>
    );

    return (
      <Flexbox className={cx(resolved && styles.resolvedThread)}>
        <CommentCard badges={badges} comment={root} variant={'plain'} onDelete={onDelete} />
        {replies.map((reply) => (
          <div className={styles.panelReply} key={reply.id}>
            <CommentCard comment={reply} variant={'plain'} onDelete={onDelete} />
          </div>
        ))}
        {canComment &&
          (replying ? (
            <Flexbox className={styles.panelActions}>
              <CommentComposer
                autoFocus
                compact
                placeholder={t('acceptance.comments.replyPlaceholder')}
                submitLabel={t('acceptance.comments.reply')}
                onCancel={() => setReplying(false)}
                onSubmit={async (content, attachments) => {
                  await onReply(root.id, content, attachments);
                  setReplying(false);
                }}
              />
            </Flexbox>
          ) : (
            <Flexbox horizontal className={styles.panelActions} gap={2}>
              <Button outdent size={'small'} type={'text'} onClick={() => setReplying(true)}>
                {t('acceptance.comments.reply')}
              </Button>
              {canResolve && (
                <Button
                  outdent
                  loading={resolving}
                  size={'small'}
                  type={'text'}
                  onClick={() => void toggleResolved()}
                >
                  {resolved ? t('acceptance.comments.reopen') : t('acceptance.comments.resolve')}
                </Button>
              )}
              {resolved && (
                <Button outdent size={'small'} type={'text'} onClick={() => setOpenOverride(false)}>
                  {t('acceptance.comments.collapseThread')}
                </Button>
              )}
            </Flexbox>
          ))}
      </Flexbox>
    );
  },
);

CommentThread.displayName = 'AcceptanceCommentThread';

export default CommentThread;
