import type { ChannelDetail, ChannelPublicJob, ChannelPublicMessage } from '@lobechat/types';
import { Button, Flexbox, Popover, Text, usePopoverContext } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ExternalLink, Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import AsyncError from '@/components/AsyncError';
import { channelActions } from '@/store/channel';

import { ChannelStatus } from './ChannelStatus';
import { channelJobStatus, channelJobTone, isChannelJobActive } from './jobStatus';
import { memberAvatar, memberName } from './memberName';
import { statusStyles, styles } from './styles';
import { useOpenReplyAgent } from './useOpenReplyAgent';

export interface ReplyEntry {
  agentId?: string | null;
  avatar: string;
  job: ChannelPublicJob;
  name: string;
}

/** Names and avatars for jobs, from the members that own them. */
export const replyEntries = (
  detail: ChannelDetail,
  jobs: ChannelPublicJob[],
  fallbackName: string,
): ReplyEntry[] =>
  jobs.map((job) => {
    const member = (detail.members ?? []).find((entry) => entry.id === job.memberId);
    return {
      agentId: member?.agentId,
      avatar: memberAvatar(member),
      job,
      name: memberName(member, fallbackName),
    };
  });

/** One reply: its state, why it failed, and how to stop it or open its Agent. */
export function ReplyDetail({
  channelId,
  entry: { agentId, avatar, job, name },
}: {
  channelId: string;
  entry: ReplyEntry;
}) {
  const { t } = useTranslation('channel');
  const { close } = usePopoverContext();
  const openAgent = useOpenReplyAgent(agentId, close);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<unknown>();
  const stop = async () => {
    setStopping(true);
    setError(undefined);
    try {
      await channelActions.stop(channelId, { jobId: job.id });
    } catch (cause) {
      console.error('Failed to stop Channel reply', cause);
      setError(cause);
    } finally {
      setStopping(false);
    }
  };
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align="center" gap={8}>
        <AgentAvatar
          agentId={agentId}
          avatar={avatar}
          name={name}
          shape={'circle'}
          size={24}
          title={name}
        />
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          {agentId ? (
            <Button
              aria-label={t('openAgentNamed', { name })}
              icon={ExternalLink}
              iconPosition="end"
              outdent="start"
              size="small"
              style={{ alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0 }}
              title={t('openAgentNamed', { name })}
              type="text"
              onClick={openAgent}
            >
              <Text ellipsis as="span" style={{ minWidth: 0 }} weight={500}>
                {name}
              </Text>
            </Button>
          ) : (
            <Text ellipsis weight={500}>
              {name}
            </Text>
          )}
        </Flexbox>
        <ChannelStatus label={t(channelJobStatus(job))} tone={channelJobTone(job)} />
      </Flexbox>
      {job.status === 'failed' && (
        <Flexbox gap={4}>
          <Text weight={500}>{t('receipt.errorReason')}</Text>
          <Text style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            {job.errorMessage?.trim() || t('receipt.errorUnavailable')}
          </Text>
        </Flexbox>
      )}
      {job.canStop && isChannelJobActive(job) && (
        <Button
          danger
          icon={Square}
          loading={stopping}
          size="small"
          style={{ alignSelf: 'flex-start' }}
          type="text"
          onClick={() => void stop()}
        >
          {t('stopReply')}
        </Button>
      )}
      {error !== undefined && <AsyncError error={error} variant="inline" />}
    </Flexbox>
  );
}

/** Replies listed one after another, as popover content. */
export function ReplyList({ channelId, entries }: { channelId: string; entries: ReplyEntry[] }) {
  return (
    <Flexbox gap={16} {...stylex.props(statusStyles.popover, statusStyles.replyList)}>
      {entries.map((entry) => (
        <ReplyDetail channelId={channelId} entry={entry} key={entry.job.id} />
      ))}
    </Flexbox>
  );
}

/**
 * A text-less marker beside a message whose reply failed, so the failure flagged in the
 * header can be traced to its message. The reason is one click away.
 */
export function MessageFailureMark({
  detail,
  message,
}: {
  detail: ChannelDetail;
  message: ChannelPublicMessage;
}) {
  const { t, i18n } = useTranslation('channel');
  const failed = (detail.jobs ?? []).filter(
    (job) => job.messageId === message.id && job.status === 'failed',
  );
  if (!failed.length) return null;
  const entries = replyEntries(detail, failed, t('unnamedAgent'));
  const label = t('failure.messageLabel', {
    names: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
      entries.map((entry) => entry.name),
    ),
  });
  return (
    <Popover
      content={<ReplyList channelId={detail.channel.id} entries={entries} />}
      placement="bottomLeft"
      trigger="click"
    >
      <button
        aria-label={label}
        title={label}
        type="button"
        {...stylex.props(statusStyles.failureMark)}
      >
        <span aria-hidden {...stylex.props(statusStyles.dot)} />
      </button>
    </Popover>
  );
}

/** A message that no Agent picked up; the routing outcome stays with the message. */
export function MessageRoutingStatus({ message }: { message: ChannelPublicMessage }) {
  const { t } = useTranslation('channel');
  if (message.routingStatus !== 'unassigned') return null;
  return (
    <span role="status" {...stylex.props(statusStyles.receipts, styles.muted)}>
      {t('routing.unassigned')}
    </span>
  );
}
