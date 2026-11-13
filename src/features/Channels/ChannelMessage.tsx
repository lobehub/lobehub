import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import {
  ActionIcon,
  Button,
  copyToClipboard,
  Divider,
  DropdownMenu,
  Flexbox,
  Icon,
  Text,
  toast,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  GitBranch,
  MessagesSquare,
  MoreHorizontal,
  Reply,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import CollapsibleContent from '@/components/CollapsibleContent';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { ChatItem } from '@/features/Conversation/ChatItem';
import Markdown from '@/features/Conversation/Markdown';
import EntityLinkElement from '@/features/EntityLink/element';
import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { authorAvatar, isCurrentUserAuthor, memberName } from './memberName';
import { CHANNEL_MENTION_TAG, remarkChannelMentions } from './mentionMarkdown';
import { MessageAttachments } from './MessageAttachments';
import { channelMessageTime, channelTimeFormatters } from './messagePresentation';
import { MessageFailureMark, MessageRoutingStatus } from './MessageReceipts';
import { showsReplyQuote } from './replyQuote';
import type { ReplyTopic } from './ReplyTopicPanel';
import { ReplyWorks } from './ReplyWorks';
import { styles } from './styles';
import type { ChannelThreadDraft } from './threadDraft';
import { ThreadPreviewCard } from './ThreadPreviewCard';
import type { ChannelReplyTarget } from './useReplyTarget';

const MentionChip = ({ children }: { children?: ReactNode }) => (
  <span {...stylex.props(styles.mention)}>{children}</span>
);
// GitHub and LobeHub links render as the same chips the conversation shows.
const messageComponents = {
  [CHANNEL_MENTION_TAG]: MentionChip,
  [EntityLinkElement.tag]: EntityLinkElement.Component,
};
const rehypePlugins = [EntityLinkElement.rehypePlugin];

/** Message text with the members it mentioned shown as chips. */
const MessageText = ({ content, names }: { content: string; names: string[] }) => {
  const key = names.join('\n');
  // Polling re-renders every message while replies run; a new plugin array would make the
  // memoized Markdown parse each message again on every refresh.
  const remarkPlugins = useMemo(() => [remarkChannelMentions(key ? key.split('\n') : [])], [key]);
  return (
    <Markdown
      components={messageComponents}
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
    >
      {content}
    </Markdown>
  );
};

export const ChannelMessage = ({
  delivery,
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
  onOpenTopic,
  pending = false,
}: {
  continuation?: boolean;
  /** For a message the server has not confirmed: its send status, in place of routing. */
  delivery?: ReactNode;
  detail: ChannelDetail;
  isRoot?: boolean;
  highlighted?: boolean;
  message: ChannelPublicMessage;
  onOpenThread?: (threadId: string) => void;
  onStartThread?: (draft: ChannelThreadDraft) => void;
  onReply?: (message: ChannelPublicMessage) => void;
  onJumpToMessage?: (message: ChannelReplyTarget) => void;
  /** Opens the Agent topic a reply came from; offered only when the server shares it. */
  onOpenTopic?: (topic: ReplyTopic) => void;
  /** Sent from this tab and not yet confirmed by the server. */
  pending?: boolean;
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
  // A continuation sits under its header, so its hover stamp only needs the clock.
  const timestamp = (
    <time
      dateTime={date.toISOString()}
      title={timeFormats.full.format(date)}
      {...stylex.props(styles.messageTime)}
    >
      {compact
        ? timeFormats.time.format(date)
        : channelMessageTime(date, { locale: i18n.language, yesterday: t('date.yesterday') })}
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
  const agentAuthorId = message.author.type === 'agent' ? message.author.id : null;
  const agentMember = agentAuthorId
    ? detail.members.find((member) => member.agentId === agentAuthorId)
    : undefined;
  const sourceTopicId = message.sourceTopicId;
  // A direct conversation is a chat with one Agent; folding its answers only adds a click.
  const collapsible = !detail.channel.agentId;
  // Long messages stay open by default; folding one is an explicit choice from "more".
  const [collapsed, setCollapsed] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const moreItems = [
    ...(agentAuthorId && sourceTopicId && onOpenTopic
      ? [
          {
            icon: MessagesSquare,
            key: 'openTopic',
            label: t('topic.open'),
            onClick: () =>
              onOpenTopic({
                agentId: agentAuthorId,
                avatar: message.author.avatar,
                name: message.author.name || t('unnamedAgent'),
                title: message.sourceTopicTitle,
                topicId: sourceTopicId,
              }),
          },
        ]
      : []),
    ...(message.content
      ? [
          {
            icon: Copy,
            key: 'copy',
            label: t('message.copy'),
            onClick: async () => {
              await copyToClipboard(message.content);
              toast.success(t('message.copied'));
            },
          },
        ]
      : []),
    ...(collapsible && overflowing
      ? [
          {
            icon: collapsed ? ChevronsUpDown : ChevronsDownUp,
            key: 'toggleCollapse',
            label: t(collapsed ? 'message.expand' : 'message.collapse'),
            onClick: () => setCollapsed(!collapsed),
          },
        ]
      : []),
  ];
  const hasToolbar = !!onReply || canBranch || moreItems.length > 0;
  const mentionNames = detail.members
    .filter((member) => message.mentions.includes(member.id))
    .map((member) => memberName(member, ''))
    .filter(Boolean);
  return (
    <div
      aria-busy={pending || undefined}
      aria-label={message.author.name || t('deletedMember')}
      data-continuation={compact || undefined}
      data-message-id={message.id}
      role="article"
      {...stylex.props(
        styles.messageRow,
        compact && hasToolbar && styles.continuationWithAction,
        highlighted && styles.highlightedMessage,
        pending && styles.pendingMessage,
        stylex.defaultMarker(),
      )}
    >
      {compact && <span {...stylex.props(styles.continuationTime)}>{timestamp}</span>}
      <ChatItem
        quietHeader
        showAvatar
        showTitle
        agentId={message.author.type === 'agent' ? message.author.id : undefined}
        avatarProps={{ shape: 'circle', size: 36 }}
        gap={4}
        id={message.id}
        paddingBlock={compact ? 2 : 8}
        placement="left"
        showHeader={!compact}
        style={{ paddingInlineStart: 48 }}
        avatar={{
          avatar: authorAvatar(message.author),
          title: message.author.name || t('deletedMember'),
        }}
        belowMessage={
          delivery ?? (isRequest ? <MessageRoutingStatus message={message} /> : undefined)
        }
        customAvatarRender={(_, avatar) => (
          <Flexbox {...stylex.props(styles.messageAvatar)}>
            {isOwnMessage ? (
              <UserAvatar shape={'circle'} size={36} />
            ) : agentAuthorId ? (
              // Same profile card an Agent shows on hover in goals and tasks.
              <AgentProfilePopup
                agentId={agentAuthorId}
                trigger={'hover'}
                agent={{
                  avatar: message.author.avatar,
                  description: agentMember?.description,
                  title: message.author.name,
                }}
              >
                <span style={{ cursor: 'pointer', display: 'inline-flex' }}>
                  <AgentAvatar
                    agentId={agentAuthorId}
                    avatar={message.author.avatar}
                    name={message.author.name}
                    shape={'circle'}
                    size={36}
                  />
                </span>
              </AgentProfilePopup>
            ) : (
              avatar
            )}
          </Flexbox>
        )}
        message={
          <Flexbox gap={8}>
            {message.via && (
              // Sent as this person's request, but written by an Agent in another Channel; a
              // receipt brings that Channel's answer back, under the Agent that gave it.
              <Flexbox horizontal align={'center'} gap={6}>
                <AgentAvatar
                  agentId={message.via.agentId}
                  avatar={message.via.avatar ?? undefined}
                  name={message.via.name}
                  shape={'circle'}
                  size={16}
                />
                <Text fontSize={12} type="secondary">
                  {message.receipt
                    ? t('message.relayReplyFrom', {
                        channel: message.receipt.channelTitle,
                        name: message.via.name,
                      })
                    : t('message.relayedBy', { name: message.via.name })}
                </Text>
              </Flexbox>
            )}
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
            {message.content &&
              (collapsible ? (
                <CollapsibleContent
                  hideCollapseToggle
                  collapsed={collapsed}
                  key={message.id}
                  maxHeight={160}
                  onCollapsedChange={setCollapsed}
                  onOverflowChange={setOverflowing}
                >
                  <MessageText content={message.content} names={mentionNames} />
                </CollapsibleContent>
              ) : (
                <MessageText content={message.content} names={mentionNames} />
              ))}
            {!!message.works?.length && <ReplyWorks works={message.works} />}
            {thread && (
              <ThreadPreviewCard
                root={message}
                thread={thread}
                onOpen={() => onOpenThread?.(thread.id)}
              />
            )}
          </Flexbox>
        }
        titleAddon={
          <>
            {timestamp}
            {isRequest && !delivery && <MessageFailureMark detail={detail} message={message} />}
          </>
        }
      />
      {hasToolbar && (
        // Icon-only, like a chat app's hover toolbar; rarer actions sit behind "more".
        <div {...stylex.props(styles.messageToolbar)}>
          {onReply && (
            <ActionIcon
              aria-label={t('reply.action')}
              icon={Reply}
              size="small"
              title={t('reply.action')}
              onClick={() => onReply(message)}
            />
          )}
          {canBranch && (
            <ActionIcon
              aria-label={t('startThread')}
              icon={GitBranch}
              size="small"
              title={t('startThread')}
              onClick={startThread}
            />
          )}
          {moreItems.length > 0 && (
            <DropdownMenu items={moreItems}>
              <ActionIcon
                aria-label={t('more', { ns: 'common' })}
                icon={MoreHorizontal}
                size="small"
                title={t('more', { ns: 'common' })}
              />
            </DropdownMenu>
          )}
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
