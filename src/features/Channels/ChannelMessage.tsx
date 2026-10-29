import type { ChannelDetail, ChannelPublicMessage } from '@lobechat/types';
import { Button, Divider, Flexbox, Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { GitBranch } from 'lucide-react';
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
import { MessageFailureMark, MessageRoutingStatus } from './MessageReceipts';
import { styles } from './styles';
import type { ChannelThreadDraft } from './threadDraft';

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
  message,
  isRoot,
  threadId,
  onOpenThread,
  onStartThread,
}: {
  detail: ChannelDetail;
  isRoot?: boolean;
  message: ChannelPublicMessage;
  onOpenThread?: (threadId: string) => void;
  onStartThread?: (draft: ChannelThreadDraft) => void;
  threadId?: string | null;
}) => {
  const { t } = useTranslation('channel');
  const isOwnMessage = useUserStore((s) =>
    isCurrentUserAuthor(message.author, userProfileSelectors.userId(s)),
  );
  // Inside a thread, its root and replies link nowhere else.
  const thread =
    !threadId && !isRoot && detail.threads.find((entry) => entry.rootMessageId === message.id);
  const canBranch = !threadId && !isRoot && !thread && !!onStartThread;
  const isRequest = message.author.type === 'user' && !isRoot;
  const mentionNames = detail.members
    .filter((member) => message.mentions.includes(member.id))
    .map((member) => memberName(member, ''))
    .filter(Boolean);
  return (
    <div data-message-id={message.id} {...stylex.props(styles.messageRow, stylex.defaultMarker())}>
      <ChatItem
        showAvatar
        showTitle
        avatarProps={{ size: 36 }}
        belowMessage={isRequest ? <MessageRoutingStatus message={message} /> : undefined}
        gap={4}
        id={message.id}
        paddingBlock={12}
        placement="left"
        style={{ paddingInlineStart: 48 }}
        time={new Date(message.createdAt).getTime()}
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
        agentId={
          message.author.type === 'agent' && !message.author.deleted ? message.author.id : undefined
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
          <CollapsibleContent key={message.id}>
            <Flexbox gap={8}>
              {message.fileIds.length > 0 && (
                <MessageAttachments attachments={detail.attachments} fileIds={message.fileIds} />
              )}
              {message.content && <MessageText content={message.content} names={mentionNames} />}
            </Flexbox>
          </CollapsibleContent>
        }
        titleAddon={
          isRequest ? (
            <MessageFailureMark detail={detail} message={message} />
          ) : message.author.deleted ? (
            <span {...stylex.props(styles.muted)}>{t('members.agentDeleted')}</span>
          ) : undefined
        }
      />
      {canBranch && (
        <div {...stylex.props(styles.messageToolbar)}>
          <Button
            icon={GitBranch}
            size="small"
            type="text"
            onClick={() =>
              onStartThread?.({
                root: message,
                attachments: detail.attachments.filter((file) => message.fileIds.includes(file.id)),
              })
            }
          >
            {t('startThread')}
          </Button>
        </div>
      )}
    </div>
  );
};

export function ThreadRootMessage({
  detail,
  root,
}: {
  detail: ChannelDetail;
  root: ChannelPublicMessage;
}) {
  const { t } = useTranslation('channel');
  return (
    <Flexbox>
      <ChannelMessage isRoot detail={detail} message={root} />
      <Divider>
        <Flexbox horizontal align="center" gap={6} {...stylex.props(styles.muted)}>
          <Icon icon={GitBranch} size={12} />
          {t('threadDivider')}
        </Flexbox>
      </Divider>
    </Flexbox>
  );
}
