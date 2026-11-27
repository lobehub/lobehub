import type { ChannelDetail, ChannelPublicJob } from '@lobechat/types';
import { Alert, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { ChatItem } from '@/features/Conversation/ChatItem';

import { useChannelMessageLayout } from './messageLayout';
import { receiptErrorText, replyEntries } from './MessageReceipts';
import { styles } from './styles';

/** Marks a failure card, so the header's failure list can scroll to it. */
export const REPLY_FAILURE_ATTRIBUTE = 'data-channel-reply-failure';

/** Why a reply failed, mounted under the Agent's message like a chat's error card. */
export function ReplyFailureCard({ job }: { job: ChannelPublicJob }) {
  const { t } = useTranslation('channel');
  return (
    <Alert
      showIcon
      data-channel-reply-failure={job.id}
      role="status"
      style={{ alignSelf: 'stretch' }}
      title={t('status.failed')}
      type="error"
      variant="outlined"
      description={
        <Flexbox gap={4}>
          <Text style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            {receiptErrorText(job, t)}
          </Text>
          <Text fontSize={12} type="secondary">
            {t('receipt.failedHint')}
          </Text>
        </Flexbox>
      }
    />
  );
}

/**
 * A failed reply that posted nothing, as the Agent's own row after the request: the card in
 * place of the answer that never came.
 */
export function ReplyFailureRow({ detail, job }: { detail: ChannelDetail; job: ChannelPublicJob }) {
  const { t } = useTranslation('channel');
  const [{ agentId, avatar, name }] = replyEntries(detail, [job], t('unnamedAgent'));
  const layout = useChannelMessageLayout();
  return (
    <div aria-label={name} role="article" {...stylex.props(styles.messageRow)}>
      <ChatItem
        quietHeader
        showAvatar
        showTitle
        agentId={agentId}
        avatar={{ avatar, title: name }}
        avatarProps={{ shape: 'circle', size: layout.avatarSize }}
        gap={layout.headerGap}
        id={`reply-failure-${job.id}`}
        message={<ReplyFailureCard job={job} />}
        paddingBlock={layout.paddingBlock}
        placement="left"
        style={{ paddingInlineStart: layout.indent }}
        customAvatarRender={() => (
          <Flexbox {...stylex.props(styles.messageAvatar(layout.paddingBlock))}>
            <AgentAvatar
              agentId={agentId}
              avatar={avatar}
              name={name}
              shape={'circle'}
              size={layout.avatarSize}
            />
          </Flexbox>
        )}
      />
    </div>
  );
}
