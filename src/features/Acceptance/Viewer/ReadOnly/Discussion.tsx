import type { AcceptanceCommentItem } from '@lobechat/types';
import { Empty, Flexbox } from '@lobehub/ui';
import { Avatar, Button, Text } from '@lobehub/ui/base-ui';
import { BadgeCheck, GitCommitHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { useActivityTime } from '@/hooks/useActivityTime';

import { useAcceptanceScope } from '../AcceptanceScope';
import CommentContent from '../Comments/CommentContent';
import { buildDiscussionTimeline } from '../Comments/discussionTimeline';
import { styles } from '../Comments/styles';
import { groupCommentThreads } from '../Comments/threads';
import TimelineEvent from '../Comments/TimelineEvent';
import { useAcceptanceCommentList } from '../Comments/useAcceptanceCommentList';
import { useAcceptanceBundle } from '../useAcceptanceBundle';

export const ReadComment = ({
  comment,
  nameOverride,
  threaded = true,
}: {
  comment: AcceptanceCommentItem;
  nameOverride?: string;
  threaded?: boolean;
}) => {
  const { t } = useTranslation('verify');
  const time = useActivityTime(comment.createdAt);
  const name = comment.author.fullName || comment.author.username || '—';

  return (
    <Flexbox
      className={styles.box}
      style={{ marginInlineStart: threaded && comment.parentCommentId ? 24 : 0 }}
    >
      <Flexbox horizontal align={'center'} className={styles.boxHeader} gap={8} wrap={'wrap'}>
        <Avatar avatar={comment.author.avatar || name.slice(0, 1)} size={20} />
        <Text weight={600}>{nameOverride ?? name}</Text>
        <Text fontSize={12} title={time.title} type={'secondary'}>
          {time.text}
        </Text>
        {comment.resolvedAt && <Text fontSize={12}>{t('acceptance.comments.resolved')}</Text>}
      </Flexbox>
      <div className={styles.body}>
        <CommentContent comment={comment} />
        {comment.reactions.length > 0 && (
          <Flexbox horizontal gap={8} style={{ paddingBlockStart: 8 }} wrap={'wrap'}>
            {comment.reactions.map((reaction) => (
              <span key={reaction.emoji}>
                {reaction.emoji} {reaction.count}
              </span>
            ))}
          </Flexbox>
        )}
      </div>
    </Flexbox>
  );
};

const ReadDiscussion = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data: bundle } = useAcceptanceBundle(acceptanceId);
  const { data, error, isLoading, mutate } = useAcceptanceCommentList(acceptanceId);

  if (!data && isLoading) return <NeuralNetworkLoading size={32} />;
  if (!data && error)
    return (
      <Empty description={t('acceptance.comments.loadFailed')}>
        <Button onClick={() => void mutate()}>{t('report.actions.retry')}</Button>
      </Empty>
    );

  const items = data?.items ?? [];
  const timeline = buildDiscussionTimeline({
    approvals: items.filter((item) => item.kind === 'approval'),
    items,
    rounds: (bundle?.rounds ?? []).map(({ run }) => ({
      createdAt: run.createdAt,
      id: run.id,
      roundIndex: run.roundIndex,
    })),
    threads: groupCommentThreads(items),
  });
  if (timeline.length === 0) return <Empty description={t('acceptance.comments.empty')} />;

  return (
    <Flexbox gap={16}>
      {timeline.map((entry) => {
        if (entry.kind === 'round') {
          const proposal = entry.proposal;
          return proposal ? (
            <ReadComment
              comment={proposal}
              key={`round-${entry.roundIndex}`}
              threaded={false}
              nameOverride={t('acceptance.comments.roundCompletedBy', {
                name: proposal.author.fullName || proposal.author.username || '—',
                round: entry.roundIndex,
              })}
            />
          ) : (
            <TimelineEvent
              at={entry.at}
              icon={GitCommitHorizontal}
              key={`round-${entry.roundIndex}`}
              text={t('acceptance.comments.roundLanded', { round: entry.roundIndex })}
            />
          );
        }
        if (entry.kind === 'approval') {
          const who = t(
            entry.approval.contextRoundIndex === null
              ? 'acceptance.comments.approvedBy'
              : 'acceptance.comments.approvedByAtRound',
            {
              name: entry.approval.author.fullName || entry.approval.author.username || '—',
              round: entry.approval.contextRoundIndex ?? 0,
            },
          );
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
        return <ReadComment comment={entry.comment} key={entry.comment.id} threaded={false} />;
      })}
    </Flexbox>
  );
};

export default ReadDiscussion;
