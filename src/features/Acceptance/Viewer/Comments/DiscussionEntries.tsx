'use client';

import type { AcceptanceCommentItem, AcceptanceCommentThread } from '@lobechat/types';
import { createStaticStyles, cssVar, cx,Flexbox, Icon  } from '@lobehub/ui';
import { GitCommitHorizontal, MessageSquare } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { checkDisplayTitle } from '../../utils';
import { useAcceptanceScope } from '../AcceptanceScope';
import { collectEvidenceById } from '../Checks/CheckHistory';
import type { AcceptanceCheck } from '../Checks/types';
import { acceptanceCheckPath } from '../routes';
import { commentAnchorId } from './anchor';
import CommentCard, { commentAuthorName, CommentAvatar } from './CommentCard';
import CommentThread from './CommentThread';
import { NODE_GUTTER, styles, TIMELINE_NODE } from './styles';
import ThreadEvidence from './ThreadEvidence';
import TimelineEvent from './TimelineEvent';

export const entryStyles = createStaticStyles(({ css }) => ({
  checkLink: css`
    font-weight: 500;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
  quote: css`
    padding-block: 6px;
    padding-inline: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 13px;
    line-height: 1.65;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  regionBody: css`
    padding-block-start: 8px;
    padding-inline-start: ${TIMELINE_NODE + NODE_GUTTER}px;
  `,
  regionHeader: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

/**
 * A round. With a note it IS the agent's turn: one entry whose header says
 * "<agent> submitted round N for review" and whose body is what they wrote.
 * Without a note it stays the plain event.
 */
export const TimelineRound = memo<{
  anchored?: boolean;
  at: Date;
  onReact: (id: string, emoji: string, on: boolean) => Promise<void>;
  proposal?: AcceptanceCommentItem;
  reactable: boolean;
  roundIndex: number;
}>(({ anchored, at, onReact, proposal, reactable, roundIndex }) => {
  const { t } = useTranslation('verify');
  if (!proposal)
    return (
      <TimelineEvent
        at={at}
        icon={GitCommitHorizontal}
        text={t('acceptance.comments.roundLanded', { round: roundIndex })}
      />
    );
  return (
    <div
      className={cx(styles.timelineEntry, anchored && styles.entryAnchored)}
      id={commentAnchorId(proposal.id)}
    >
      <CommentCard
        anchored
        comment={proposal}
        reactable={reactable}
        variant={'feed'}
        nameOverride={t('acceptance.comments.roundCompletedBy', {
          name: commentAuthorName(proposal.author),
          round: roundIndex,
        })}
        onReact={onReact}
      />
    </div>
  );
});

TimelineRound.displayName = 'AcceptanceTimelineRound';

export const TimelineMessage = memo<{
  anchored: boolean;
  comment: AcceptanceCommentItem;
  onDelete: (id: string) => Promise<void>;
  onReact: (id: string, emoji: string, on: boolean) => Promise<void>;
  reactable: boolean;
}>(({ anchored, comment, onDelete, onReact, reactable }) => (
  <div
    className={cx(styles.timelineEntry, anchored && styles.entryAnchored)}
    id={commentAnchorId(comment.id)}
  >
    <CommentCard
      anchored
      comment={comment}
      reactable={reactable}
      variant={'feed'}
      onDelete={onDelete}
      onReact={onReact}
    />
  </div>
));

TimelineMessage.displayName = 'AcceptanceTimelineMessage';

/**
 * "C2 · title", the way the checklist names a check. A link out of the page
 * route opens that check's own view; an embedded viewer has no route of its own,
 * so there it is just the name.
 */
export const CheckReference = memo<{ check?: AcceptanceCheck }>(({ check }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  if (!check) return null;
  const label = `C${check.seq} · ${checkDisplayTitle(check.title, t('acceptance.checks.holisticTitle'))}`;
  if (embedded) return <span className={entryStyles.checkLink}>{label}</span>;
  return (
    <Link className={entryStyles.checkLink} to={acceptanceCheckPath(acceptanceId, check.id)}>
      {label}
    </Link>
  );
});

CheckReference.displayName = 'AcceptanceDiscussionCheckReference';

/**
 * A note circled on a screenshot, as a pull request shows a review comment in
 * its Conversation: which check it is about, the picture it points at, and the
 * thread itself — still answerable and closable from here.
 */
export const TimelineRegion = memo<{
  anchored: boolean;
  canComment: boolean;
  canResolve: boolean;
  check?: AcceptanceCheck;
  onDelete: (id: string) => Promise<void>;
  onReply: (rootId: string, content: string, attachments: { fileId: string }[]) => Promise<void>;
  onResolve: (rootId: string, resolved: boolean) => Promise<void>;
  thread: AcceptanceCommentThread;
}>(({ anchored, canComment, canResolve, check, onDelete, onReply, onResolve, thread }) => {
  const { t } = useTranslation('verify');
  const { root } = thread;
  const evidence =
    check && root.evidenceId ? collectEvidenceById(check).get(root.evidenceId) : undefined;
  const stale = Boolean(
    check && root.evidenceId && !check.evidence.some((item) => item.id === root.evidenceId),
  );

  return (
    <div
      className={cx(styles.timelineEntry, anchored && styles.entryAnchored)}
      id={commentAnchorId(root.id)}
    >
      <Flexbox
        horizontal
        align={'center'}
        className={entryStyles.regionHeader}
        gap={NODE_GUTTER}
        wrap={'wrap'}
      >
        <CommentAvatar comment={root} size={TIMELINE_NODE} />
        <Icon icon={MessageSquare} size={13} />
        <span>
          {check
            ? t('acceptance.comments.regionOn', { name: commentAuthorName(root.author) })
            : commentAuthorName(root.author)}
        </span>
        <CheckReference check={check} />
      </Flexbox>
      <Flexbox
        horizontal
        align={'flex-start'}
        className={entryStyles.regionBody}
        gap={16}
        wrap={'wrap'}
      >
        {evidence && (
          <ThreadEvidence
            comment={root}
            evidence={evidence}
            stale={stale}
            roundIndex={
              check?.timeline.find((entry) =>
                entry.evidence.some((item) => item.id === root.evidenceId),
              )?.roundIndex
            }
          />
        )}
        <Flexbox flex={1} style={{ minWidth: 220 }}>
          <CommentThread
            canComment={canComment}
            canResolve={canResolve}
            thread={thread}
            onDelete={onDelete}
            onReply={onReply}
            onResolve={onResolve}
          />
        </Flexbox>
      </Flexbox>
    </div>
  );
});

TimelineRegion.displayName = 'AcceptanceTimelineRegion';
