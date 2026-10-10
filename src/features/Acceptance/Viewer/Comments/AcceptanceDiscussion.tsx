'use client';

import type { AcceptanceCommentThread } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BadgeCheck, Undo2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/selectors';
import { buildAuthReturnUrl, currentReturnPath } from '@/utils/authReturnUrl';

import { useAcceptanceScope } from '../AcceptanceScope';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { useCommentAnchor } from './anchor';
import { commentAuthorName } from './CommentCard';
import CommentComposer from './CommentComposer';
import DiscussionAside from './DiscussionAside';
import {
  CheckReference,
  entryStyles,
  TimelineMessage,
  TimelineRegion,
  TimelineRound,
} from './DiscussionEntries';
import { type DiscussionSection, groupDiscussionByRound } from './discussionRounds';
import type { DiscussionEntry } from './discussionTimeline';
import { buildDiscussionTimeline } from './discussionTimeline';
import { useAcceptanceComments } from './hooks';
import RoundSection from './RoundSection';
import { styles } from './styles';
import TimelineEvent from './TimelineEvent';

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
  composer: css`
    margin-block: 12px 4px;
  `,
  empty: css`
    padding-block: 16px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  feed: css`
    flex: 999 1 480px;
    min-width: 0;
  `,
  round: css`
    & + & {
      margin-block-start: 28px;
    }
  `,
  layout: css`
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    align-items: flex-start;
  `,
  signInPrompt: css`
    padding-block: 16px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
}));

const entryCommentIds = (entry: DiscussionEntry): string[] => {
  if (entry.kind === 'message') return [entry.comment.id];
  if (entry.kind === 'region')
    return [entry.thread.root.id, ...entry.thread.replies.map((reply) => reply.id)];
  if (entry.kind === 'round' && entry.proposal) return [entry.proposal.id];
  return [];
};

const sectionKey = (section: DiscussionSection) => String(section.roundIndex ?? 'before');

/**
 * The delivery's activity, one section per round: what landed, what people
 * said about it, and how it was decided. The newest round reads first and
 * open; older rounds fold to their header line.
 *
 * Deciding stays on the checklist, where the evidence is — the aside only
 * points there.
 */
const AcceptanceDiscussion = memo<{ onOpenChecks?: () => void }>(({ onOpenChecks }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId, embedded } = useAcceptanceScope();
  const viewerId = useUserStore(userProfileSelectors.userId);
  const isSignedIn = useUserStore(authSelectors.isLogin);
  const { data } = useAcceptanceBundle(acceptanceId);
  const {
    canApprove,
    canComment,
    create,
    error,
    isLoading,
    items,
    react,
    remove,
    setResolved,
    threads,
  } = useAcceptanceComments(acceptanceId);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const currentRunId = data?.rounds.at(-1)?.run.id;
  const anchoredId = useCommentAnchor(items, embedded);
  const checksById = useMemo(
    () => new Map((data?.checks ?? []).map((check) => [check.id, check])),
    [data?.checks],
  );

  const timeline = useMemo(
    () =>
      buildDiscussionTimeline({
        approvals: items.filter((item) => item.kind === 'approval'),
        checks: data?.checks,
        items,
        rounds: (data?.rounds ?? []).map(({ run }) => ({
          createdAt: run.createdAt,
          decisionDetail: run.decisionDetail,
          id: run.id,
          roundIndex: run.roundIndex,
          userDecision: run.userDecision,
        })),
        threads,
      }),
    [data?.checks, data?.rounds, items, threads],
  );
  const sections = useMemo(() => groupDiscussionByRound(timeline), [timeline]);
  const anchoredSection = anchoredId
    ? sections.find((section) =>
        section.entries.some((entry) => entryCommentIds(entry).includes(anchoredId)),
      )
    : undefined;

  // Same rule as on the check row: whoever raised a note may close it, and
  // the delivery's reviewers may close anyone's.
  const canResolveThread = useCallback(
    (thread: AcceptanceCommentThread) =>
      canApprove ||
      (Boolean(viewerId) && thread.root.authorUserId === viewerId && !thread.root.deletedAt),
    [canApprove, viewerId],
  );
  const replyToRegion = (rootId: string, content: string, attachments: { fileId: string }[]) =>
    create({
      attachments,
      clientId: `${rootId}:${Date.now()}`,
      content,
      contextRunId: currentRunId,
      parentCommentId: rootId,
    });

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
    if (entry.kind === 'region')
      return (
        <TimelineRegion
          anchored={entry.thread.root.id === anchoredId}
          canComment={canComment}
          canResolve={canResolveThread(entry.thread)}
          key={entry.thread.root.id}
          thread={entry.thread}
          check={
            entry.thread.root.checkItemId
              ? checksById.get(entry.thread.root.checkItemId)
              : undefined
          }
          onDelete={remove}
          onReply={replyToRegion}
          onResolve={setResolved}
        />
      );
    if (entry.kind === 'checkReject') {
      const check = checksById.get(entry.checkItemId);
      return (
        <TimelineEvent
          at={entry.at}
          icon={Undo2}
          key={`reject-${entry.checkItemId}-${entry.at.getTime()}`}
          text={
            <>
              <CheckReference check={check} />{' '}
              {t('acceptance.comments.checkRejected', { round: entry.roundIndex })}
              {entry.annotationCount > 0 &&
                ` · ${t('acceptance.comments.checkRejectedRegions', { count: entry.annotationCount })}`}
            </>
          }
        >
          {entry.comment && <div className={entryStyles.quote}>{entry.comment}</div>}
        </TimelineEvent>
      );
    }
    if (entry.kind === 'roundReject')
      return (
        <TimelineEvent
          at={entry.at}
          icon={Undo2}
          key={`round-reject-${entry.roundIndex}`}
          text={t('acceptance.comments.roundRejected', { round: entry.roundIndex })}
        >
          {entry.comment && <div className={entryStyles.quote}>{entry.comment}</div>}
        </TimelineEvent>
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
      // read nowhere else, so it belongs on the line that announces it.
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
        onDelete={remove}
        onReact={react}
      />
    );
  };

  const reply = canComment ? (
    <Flexbox className={local.composer}>
      <Flexbox className={styles.composerBlock}>
        <CommentComposer
          borderless
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
  );

  const ungrouped = sections.length <= 1 && (sections[0]?.roundIndex ?? null) === null;

  return (
    <div className={local.layout}>
      <Flexbox className={local.feed}>
        {timeline.length === 0 && (
          <span className={local.empty}>{t('acceptance.comments.empty')}</span>
        )}
        {ungrouped ? (
          <>
            {sections[0]?.entries.map((entry) => renderEntry(entry))}
            {reply}
          </>
        ) : (
          sections.map((section, index) => {
            const key = sectionKey(section);
            const open = toggled[key] ?? (index === 0 || section === anchoredSection);
            return (
              <div className={local.round} key={key}>
                <RoundSection
                  open={open}
                  section={section}
                  onToggle={() => setToggled((state) => ({ ...state, [key]: !open }))}
                >
                  {section.entries.map((entry) => renderEntry(entry))}
                </RoundSection>
                {index === 0 && reply}
              </div>
            );
          })
        )}
      </Flexbox>
      <DiscussionAside
        items={items}
        latestRound={data?.rounds.at(-1)?.run.roundIndex ?? undefined}
        status={data?.acceptance.status}
        onOpenChecks={onOpenChecks}
      />
    </div>
  );
});

AcceptanceDiscussion.displayName = 'AcceptanceDiscussion';

export default AcceptanceDiscussion;
