'use client';

import type { AcceptanceCommentItem } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { BadgeCheck, GitCommitHorizontal } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityTime } from '@/hooks/useActivityTime';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';
import { buildAuthReturnUrl, currentReturnPath } from '@/utils/authReturnUrl';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { commentAnchorId, useCommentAnchor } from './anchor';
import CommentCard, { commentAuthorName, CommentAvatar } from './CommentCard';
import CommentComposer from './CommentComposer';
import type { DiscussionEntry } from './discussionTimeline';
import { buildDiscussionTimeline } from './discussionTimeline';
import { useAcceptanceComments } from './hooks';
import { styles, TIMELINE_NODE } from './styles';

/** Enough room to start writing without the box dominating the column. */
const COMPOSER_MIN_HEIGHT = 80;

/**
 * The end of a discussion a signed-out reader cannot join. A bare line of grey
 * text states the rule and leaves them there; the way in belongs in the same
 * place the reply box would have been, which is what GitHub does under a
 * thread on a public repo.
 */
const SignInPrompt = memo(() => {
  const { t } = useTranslation('verify');
  return (
    <Flexbox className={local.signInPrompt} gap={10}>
      <Text weight={600}>{t('acceptance.comments.signInTitle')}</Text>
      <Text fontSize={13} type={'secondary'}>
        {t('acceptance.comments.signInDescription')}
      </Text>
      <Flexbox horizontal gap={8}>
        <Button href={buildAuthReturnUrl('signin', currentReturnPath())} type={'primary'}>
          {t('acceptance.comments.signIn')}
        </Button>
        <Button href={buildAuthReturnUrl('signup', currentReturnPath())}>
          {t('acceptance.comments.signUp')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

SignInPrompt.displayName = 'AcceptanceDiscussionSignInPrompt';

const local = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 16px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  signInPrompt: css`
    padding-block: 16px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

/** A round landing or an approval — a dot on the rail and one line of text. */
const TimelineEvent = memo<{ at: Date; icon: typeof BadgeCheck; text: string }>(
  ({ at, icon, text }) => {
    const time = useActivityTime(at);
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={cx(styles.timelineEntry, styles.eventEntry)}
        gap={12}
      >
        <span className={styles.eventDot}>
          <Icon icon={icon} size={12} />
        </span>
        <Flexbox horizontal align={'center'} className={styles.event} gap={8} wrap={'wrap'}>
          <span>{text}</span>
          <span className={styles.meta} title={time.title}>
            {time.text}
          </span>
        </Flexbox>
      </Flexbox>
    );
  },
);

TimelineEvent.displayName = 'AcceptanceTimelineEvent';

/**
 * A round. With a note it IS the agent's turn: one entry whose header says
 * "<agent> completed round N" and whose body is what they wrote. The landing
 * and the author are the same sentence, so neither an event row above the note
 * nor a second author line is needed. Without a note it stays the plain event.
 */
const TimelineRound = memo<{
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
    <Flexbox
      horizontal
      align={'flex-start'}
      className={styles.timelineEntry}
      gap={12}
      id={commentAnchorId(proposal.id)}
    >
      <span className={styles.timelineNode}>
        <CommentAvatar comment={proposal} size={TIMELINE_NODE} />
      </span>
      <Flexbox className={cx(styles.box, anchored && styles.boxAnchored)}>
        <CommentCard
          anchored
          comment={proposal}
          reactable={reactable}
          nameOverride={t('acceptance.comments.roundCompletedBy', {
            name: commentAuthorName(proposal.author),
            round: roundIndex,
          })}
          onReact={onReact}
        />
      </Flexbox>
    </Flexbox>
  );
});

TimelineRound.displayName = 'AcceptanceTimelineRound';

/** One chat message: the author's face on the rail, the remark beside it. */
const TimelineMessage = memo<{
  anchored: boolean;
  comment: AcceptanceCommentItem;
  onDelete: (id: string) => Promise<void>;
  onReact: (id: string, emoji: string, on: boolean) => Promise<void>;
  reactable: boolean;
  /** Written by whoever is reading — GitHub paints their own turns blue. */
  self: boolean;
}>(({ anchored, comment, onDelete, onReact, reactable, self }) => (
  <Flexbox
    horizontal
    align={'flex-start'}
    className={styles.timelineEntry}
    gap={12}
    id={commentAnchorId(comment.id)}
  >
    <span className={styles.timelineNode}>
      <CommentAvatar comment={comment} size={TIMELINE_NODE} />
    </span>
    <Flexbox className={cx(styles.box, self && styles.boxSelf, anchored && styles.boxAnchored)}>
      <CommentCard
        anchored
        comment={comment}
        reactable={reactable}
        onDelete={onDelete}
        onReact={onReact}
      />
    </Flexbox>
  </Flexbox>
));

TimelineMessage.displayName = 'AcceptanceTimelineMessage';

/*
 * The rail runs inside the boxes rather than under the avatars, so nothing here
 * needs to sit above the line: the opaque boxes cover it, the event dots stand
 * on it, and the gaps between turns are where it shows.
 */

/**
 * The delivery's chat: one message per turn, strung on a rail with the rounds
 * that landed and the approvals people gave, and the composer at the end.
 *
 * Only chat lives here. A note circled on a screenshot reads next to that spot
 * and nowhere else, so it stays on the check that owns the evidence — which is
 * also why nothing here offers "reply" or "resolve": those belong to a note
 * about a place, not to a remark in a conversation.
 */
const AcceptanceDiscussion = memo(() => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  const viewerId = useUserStore(userProfileSelectors.userId);
  const isSignedIn = useUserStore(authSelectors.isLogin);
  const { data } = useAcceptanceBundle(acceptanceId);
  const { canComment, create, error, isLoading, items, react, remove, threads } =
    useAcceptanceComments(acceptanceId);

  const currentRunId = data?.rounds.at(-1)?.run.id;
  const anchoredId = useCommentAnchor(items, embedded);

  const timeline = useMemo(
    () =>
      buildDiscussionTimeline({
        approvals: items.filter((item) => item.kind === 'approval'),
        items,
        rounds: (data?.rounds ?? []).map(({ run }) => ({
          createdAt: run.createdAt,
          id: run.id,
          roundIndex: run.roundIndex,
        })),
        threads,
      }),
    [data?.rounds, items, threads],
  );

  if (isLoading && timeline.length === 0 && !canComment) return null;

  const renderEntry = (entry: DiscussionEntry) => {
    if (entry.kind === 'round')
      return (
        <TimelineRound
          anchored={Boolean(entry.proposal) && entry.proposal?.id === anchoredId}
          at={entry.at}
          key={`round-${entry.roundIndex}`}
          proposal={entry.proposal}
          reactable={canComment}
          roundIndex={entry.roundIndex}
          onReact={react}
        />
      );
    if (entry.kind === 'approval') {
      const who =
        entry.approval.contextRoundIndex === null
          ? t('acceptance.comments.approvedBy', {
              name: commentAuthorName(entry.approval.author),
            })
          : t('acceptance.comments.approvedByAtRound', {
              name: commentAuthorName(entry.approval.author),
              round: entry.approval.contextRoundIndex,
            });
      // The reviewer's optional one-line summary. Written into the same row and
      // read nowhere else, so it belongs on the line that announces it — a
      // field nobody can read back is worse than no field.
      const said = entry.approval.content.trim();
      return (
        <TimelineEvent
          at={entry.at}
          icon={BadgeCheck}
          key={entry.approval.id}
          text={said ? `${who} · ${said}` : who}
        />
      );
    }
    return (
      <TimelineMessage
        anchored={entry.comment.id === anchoredId}
        comment={entry.comment}
        key={entry.comment.id}
        reactable={canComment}
        self={Boolean(viewerId) && entry.comment.authorUserId === viewerId}
        onDelete={remove}
        onReact={react}
      />
    );
  };

  return (
    <Flexbox>
      {timeline.length === 0 && (
        <span className={local.empty}>{t('acceptance.comments.empty')}</span>
      )}
      {timeline.map((entry) => renderEntry(entry))}

      {/* Last, like GitHub's Conversation: you read the thread, then answer it. */}
      {canComment ? (
        <Flexbox className={cx(styles.timelineEntry, styles.nodelessEntry, styles.tailEntry)}>
          <Flexbox className={styles.composerBlock}>
            <CommentComposer
              minHeight={COMPOSER_MIN_HEIGHT}
              placeholder={t('acceptance.comments.placeholder')}
              onSubmit={(content, attachments) =>
                create({
                  attachments,
                  clientId: nanoid(),
                  content,
                  contextRunId: currentRunId,
                })
              }
            />
          </Flexbox>
        </Flexbox>
      ) : error ? (
        // A read that failed says nothing about permission.
        <Text fontSize={13} type={'secondary'}>
          {t('acceptance.comments.loadFailed')}
        </Text>
      ) : isLoading ? null : isSignedIn ? ( // Neither line below is true yet while the answer is in flight.
        <Text fontSize={13} type={'secondary'}>
          {t('acceptance.comments.readOnly')}
        </Text>
      ) : (
        <SignInPrompt />
      )}
    </Flexbox>
  );
});

AcceptanceDiscussion.displayName = 'AcceptanceDiscussion';

export default AcceptanceDiscussion;
