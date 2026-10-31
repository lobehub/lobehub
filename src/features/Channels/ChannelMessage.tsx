import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { ActionIcon, Button, Divider, Flexbox, Icon, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { GitBranch, Reply } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CollapsibleContent from '@/components/CollapsibleContent';
import { ChatItem } from '@/features/Conversation/ChatItem';
import Markdown from '@/features/Conversation/Markdown';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { authorAvatar, isCurrentUserAuthor, memberName } from './memberName';
import { CHANNEL_MENTION_TAG, remarkChannelMentions } from './mentionMarkdown';
import { MessageAttachments } from './MessageAttachments';
import { channelTimeFormatters } from './messagePresentation';
import { MessageFailureMark, MessageRoutingStatus } from './MessageReceipts';
import { showsReplyQuote } from './replyQuote';
import { styles } from './styles';
import type { ChannelThreadDraft } from './threadDraft';
import type { ChannelReplyTarget } from './useReplyTarget';

const MentionChip = ({ children }: { children?: ReactNode }) => (
  <span {...stylex.props(styles.mention)}>{children}</span>
);
const mentionComponents = { [CHANNEL_MENTION_TAG]: MentionChip };

/** Message text with the members it mentioned shown as chips. */
const MessageText = ({ content, names }: { content: string; names: string[] }) => {
  const key = names.join('\n');
  // Polling re-renders every message while replies run; a new plugin array would make the
  // memoized Markdown parse each message again on every refresh.
  const remarkPlugins = useMemo(() => [remarkChannelMentions(key ? key.split('\n') : [])], [key]);
  return (
    <Markdown components={mentionComponents} remarkPlugins={remarkPlugins}>
      {content}
    </Markdown>
  );
};

export const ChannelMessage = ({
  detail,
  continuation = false,
  message,
  isRoot,
  highlighted,
  threadId,
  onOpenThread,
  onStartThread,
  onReply,
  onJumpToMessage,
}: {
  continuation?: boolean;
  detail: ChannelDetail;
  isRoot?: boolean;
  highlighted?: boolean;
  message: ChannelPublicMessage;
  onOpenThread?: (threadId: string) => void;
  onStartThread?: (draft: ChannelThreadDraft) => void;
  onReply?: (message: ChannelPublicMessage) => void;
  onJumpToMessage?: (message: ChannelReplyTarget) => void;
  threadId?: string | null;
}) => {
  const { t, i18n } = useTranslation('channel');
  const timeFormats = useMemo(() => channelTimeFormatters(i18n.language), [i18n.language]);
  const date = new Date(message.createdAt);
  // Failed/unassigned requests keep their identity row and recovery affordance.
  const compact =
    continuation &&
    !isRoot &&
    message.routingStatus !== 'unassigned' &&
    !detail.jobs.some((job) => job.messageId === message.id && job.status === 'failed');
  const timestamp = (
    <time
      dateTime={date.toISOString()}
      title={timeFormats.full.format(date)}
      {...stylex.props(styles.messageTime)}
    >
      {timeFormats.time.format(date)}
    </time>
  );
  const isOwnMessage = useUserStore((s) =>
    isCurrentUserAuthor(message.author, userProfileSelectors.userId(s)),
  );
  // Inside a thread, its root and replies link nowhere else.
  const thread =
    !threadId && !isRoot && detail.threads.find((entry) => entry.rootMessageId === message.id);
  const canBranch = !threadId && !isRoot && !thread && !!onStartThread;
  const startThread = () =>
    onStartThread?.({
      root: message,
      attachments: detail.attachments.filter((file) => message.fileIds.includes(file.id)),
    });
  const isRequest = message.author.type === 'user' && !isRoot;
  const mentionNames = detail.members
    .filter((member) => message.mentions.includes(member.id))
    .map((member) => memberName(member, ''))
    .filter(Boolean);
  return (
    <div
      aria-label={message.author.name || t('deletedMember')}
      data-continuation={compact || undefined}
      data-message-id={message.id}
      role="article"
      {...stylex.props(
        styles.messageRow,
        compact && (onReply || canBranch) && styles.continuationWithAction,
        highlighted && styles.highlightedMessage,
        stylex.defaultMarker(),
      )}
    >
      {compact && <span {...stylex.props(styles.continuationTime)}>{timestamp}</span>}
      <ChatItem
        showAvatar
        showTitle
        agentId={message.author.type === 'agent' ? message.author.id : undefined}
        avatarProps={{ size: 36 }}
        belowMessage={isRequest ? <MessageRoutingStatus message={message} /> : undefined}
        gap={4}
        id={message.id}
        paddingBlock={compact ? 2 : 8}
        placement="left"
        showHeader={!compact}
        style={{ paddingInlineStart: 48 }}
        actionAddon={
          thread ? (
            <Button
              icon={GitBranch}
              size="small"
              type="text"
              onClick={() => onOpenThread?.(thread.id)}
            >
              {t('openThread')}
            </Button>
          ) : undefined
        }
        avatar={{
          avatar: authorAvatar(message.author),
          title: message.author.name || t('deletedMember'),
        }}
        customAvatarRender={(_, avatar) => (
          <Flexbox {...stylex.props(styles.messageAvatar)}>
            {isOwnMessage ? <UserAvatar size={36} /> : avatar}
          </Flexbox>
        )}
        message={
          <Flexbox gap={8}>
              {!isRoot &&
                showsReplyQuote(message) &&
                (message.replyTo ? (
                  <Button
                    aria-label={t('reply.viewOriginal')}
                    icon={Reply}
                    size="small"
                    style={{ alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0 }}
                    type="text"
                    onClick={() => onJumpToMessage?.(message.replyTo!)}
                  >
                    <Text ellipsis as="span" fontSize={12} type="secondary">
                      {message.replyTo.author.name || t('deletedMember')}
                      {': '}
                      {message.replyTo.content || t('reply.attachment')}
                    </Text>
                  </Button>
                ) : (
                  <Text fontSize={12} type="secondary">
                    {t('reply.unavailable')}
                  </Text>
                ))}
            {message.fileIds.length > 0 && (
              <MessageAttachments attachments={detail.attachments} fileIds={message.fileIds} />
            )}
            {message.content && (
              <CollapsibleContent key={message.id} maxHeight={160}>
                <MessageText content={message.content} names={mentionNames} />
              </CollapsibleContent>
            )}
          </Flexbox>
        }
        titleAddon={
          <>
            {timestamp}
            {isRequest && <MessageFailureMark detail={detail} message={message} />}
          </>
        }
      />
      {(onReply || canBranch) && (
        <div {...stylex.props(styles.messageToolbar)}>
          {onReply &&
            (compact ? (
              <ActionIcon
                aria-label={t('reply.action')}
                icon={Reply}
                size="small"
                title={t('reply.action')}
                onClick={() => onReply(message)}
              />
            ) : (
              <Button icon={Reply} size="small" type="text" onClick={() => onReply(message)}>
                {t('reply.action')}
              </Button>
            ))}
          {canBranch &&
            (compact ? (
              <ActionIcon
                aria-label={t('startThread')}
                icon={GitBranch}
                size="small"
                title={t('startThread')}
                onClick={startThread}
              />
            ) : (
              <Button icon={GitBranch} size="small" type="text" onClick={startThread}>
                {t('startThread')}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
};

export function ThreadRootMessage({
  detail,
  root,
  onReply,
  highlighted,
}: {
  detail: ChannelDetail;
  root: ChannelPublicMessage;
  onReply?: (message: ChannelPublicMessage) => void;
  highlighted?: boolean;
}) {
  const { t } = useTranslation('channel');
  return (
    <Flexbox>
      <ChannelMessage
        isRoot
        detail={detail}
        highlighted={highlighted}
        message={root}
        onReply={onReply}
      />
      <Divider>
        <Flexbox horizontal align="center" gap={6} {...stylex.props(styles.muted)}>
          <Icon icon={GitBranch} size={12} />
          {t('threadDivider')}
        </Flexbox>
      </Divider>
    </Flexbox>
  );
}
