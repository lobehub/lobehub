import type { ChannelDetail } from '@lobechat/types';
import { Avatar, Button, Popover } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import { channelJobStatus, memberCurrentJob, replyActivityJobs } from './jobStatus';
import { replyEntries, ReplyList } from './MessageReceipts';
import { activityStyles, styles } from './styles';

const MAX_AVATARS = 3;

const TypingDots = () => (
  <span aria-hidden {...stylex.props(activityStyles.dots)}>
    {[0, 1, 2].map((index) => (
      <span key={index} {...stylex.props(activityStyles.typingDot, activityStyles.delay(index))} />
    ))}
  </span>
);

/**
 * Who is replying in this conversation, above the composer like a chat app's typing line.
 * One click lists each reply with its state and a stop action.
 */
export function ReplyActivity({
  detail,
  threadId,
}: {
  detail: ChannelDetail;
  threadId: string | null;
}) {
  const { t, i18n } = useTranslation('channel');
  const { jobs: allJobs = [], messages = [] } = detail;
  const jobs = replyActivityJobs(allJobs.filter((job) => (job.threadId ?? null) === threadId));
  const receiving = messages.some((message) => message.routingStatus === 'pending');
  if (!jobs.length)
    return receiving ? (
      <span role="status" {...stylex.props(activityStyles.line, styles.muted)}>
        <TypingDots />
        {t('routing.receiving')}
      </span>
    ) : null;

  const entries = replyEntries(detail, jobs, t('unnamedAgent'));
  // One Agent may have several requests queued; describe each Agent once.
  const members = [...new Map(entries.map((entry) => [entry.job.memberId, entry])).values()];
  const names = members.map((entry) => entry.name);
  const label =
    members.length === 1
      ? t('activity.one', {
          name: names[0],
          status: t(channelJobStatus(memberCurrentJob(jobs, members[0].job.memberId)!)),
        })
      : members.length === 2
        ? t('activity.two', {
            names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names),
          })
        : t('activity.many', { count: members.length });
  const avatars = members.slice(0, MAX_AVATARS);

  return (
    <Popover
      content={<ReplyList channelId={detail.channel.id} entries={entries} />}
      placement="topLeft"
      trigger="click"
    >
      <Button
        size="small"
        type="text"
        {...stylex.props(activityStyles.line, activityStyles.button)}
      >
        <span aria-hidden {...stylex.props(activityStyles.avatars)}>
          {avatars.map((entry) => (
            <Avatar avatar={entry.avatar} key={entry.job.id} size={16} title={entry.name} />
          ))}
        </span>
        <span role="status" {...stylex.props(activityStyles.label)}>
          {label}
        </span>
        <TypingDots />
      </Button>
    </Popover>
  );
}
