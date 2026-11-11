import type { ChannelDetail } from '@lobechat/types';
import { Button, Popover } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';

import { activityLabel } from './activityLabel';
import {
  channelJobStatus,
  conversationReplies,
  directReplyStatus,
  memberCurrentJob,
} from './jobStatus';
import { replyEntries, ReplyList } from './MessageReceipts';
import { activityStyles, styles } from './styles';
import { TypingDots } from './TypingDots';

const MAX_AVATARS = 3;

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
  const { jobs, receiving } = conversationReplies(detail, threadId);
  if (!jobs.length)
    return receiving ? (
      <span role="status" {...stylex.props(activityStyles.line, styles.muted)}>
        <TypingDots />
        {activityLabel(t('routing.receiving'))}
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
            <AgentAvatar
              agentId={entry.agentId}
              avatar={entry.avatar}
              key={entry.job.id}
              name={entry.name}
              shape={'circle'}
              size={16}
              title={entry.name}
            />
          ))}
        </span>
        <span role="status" {...stylex.props(activityStyles.label)}>
          {activityLabel(label)}
        </span>
        <TypingDots />
      </Button>
    </Popover>
  );
}

/**
 * A direct conversation has one Agent to wait on, so its state sits beside the Agent's name in
 * the header like an IM's "typing…". Anything other than plain work says what it waits on.
 */
export function DirectReplyStatus({ detail }: { detail: ChannelDetail }) {
  const { t } = useTranslation('channel');
  const reply = directReplyStatus(detail);
  if (!reply) return null;

  const { jobs, waiting } = reply;
  const label = activityLabel(waiting ? t(channelJobStatus(waiting)) : t('activity.typing'));
  const status = (
    <span role="status" {...stylex.props(activityStyles.line, activityStyles.header)}>
      <span {...stylex.props(activityStyles.label)}>{label}</span>
      {!waiting && <TypingDots />}
    </span>
  );
  if (!jobs.length) return status;

  return (
    <Popover
      placement="bottomLeft"
      trigger="click"
      content={
        <ReplyList
          channelId={detail.channel.id}
          entries={replyEntries(detail, jobs, t('unnamedAgent'))}
        />
      }
    >
      <Button size="small" type="text" {...stylex.props(activityStyles.headerButton)}>
        {status}
      </Button>
    </Popover>
  );
}
