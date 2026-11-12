import type { ChannelPublicMessage, ChannelPublicThread } from '@lobechat/types';
import { Avatar, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ChevronRight, GitBranch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import UserAvatar from '@/features/User/UserAvatar';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { authorAvatar, isCurrentUserAuthor } from './memberName';
import { threadTitle } from './threadTitle';

dayjs.extend(relativeTime);

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: 520,
    marginBlock: 0,
    marginInline: 0,
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      'default': cssVar.colorBorderSecondary,
      ':hover': cssVar.colorBorder,
    },
    borderRadius: cssVar.borderRadiusLG,
    font: 'inherit',
    textAlign: 'start',
    backgroundColor: {
      'default': cssVar.colorBgContainer,
      ':hover': cssVar.colorFillQuaternary,
    },
    cursor: 'pointer',
  },
  row: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    minWidth: 0,
  },
  title: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 500,
    color: cssVar.colorPrimary,
  },
  icon: { flexShrink: 0, color: cssVar.colorTextTertiary },
  author: {
    flexShrink: 0,
    maxWidth: 160,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  preview: {
    overflow: 'hidden',
    flex: '1',
    minWidth: 0,
    fontSize: 12,
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  time: {
    flexShrink: 0,
    fontSize: 12,
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
    // ChatItem hides every `time` inside a message until hover; this one is content, not a stamp.
    opacity: 1,
  },
});

/** A message's thread as a card under it: what it is about, how much was said, and the latest word. */
export const ThreadPreviewCard = ({
  onOpen,
  root,
  thread,
}: {
  onOpen?: () => void;
  root: ChannelPublicMessage;
  thread: ChannelPublicThread;
}) => {
  const { t } = useTranslation('channel');
  const { lastReply, replyCount } = thread;
  // Same rule as the message header: the viewer's own replies use their live avatar.
  const isOwnReply = useUserStore(
    (s) => !!lastReply && isCurrentUserAuthor(lastReply.author, userProfileSelectors.userId(s)),
  );
  return (
    <button type="button" {...stylex.props(styles.card)} onClick={onOpen}>
      <span {...stylex.props(styles.row)}>
        <Icon icon={GitBranch} size={14} {...stylex.props(styles.icon)} />
        <span {...stylex.props(styles.title)}>{threadTitle(root) ?? t('thread')}</span>
        <span {...stylex.props(styles.count)}>
          {/* Views cached before thread summaries existed only know that the thread exists. */}
          {replyCount ? t('threadCard.replies', { count: replyCount }) : t('openThread')}
          <Icon icon={ChevronRight} size={14} />
        </span>
      </span>
      {lastReply && (
        <span {...stylex.props(styles.row)}>
          {isOwnReply ? (
            <UserAvatar shape="circle" size={16} />
          ) : (
            <Avatar
              avatar={authorAvatar(lastReply.author)}
              shape="circle"
              size={16}
              title={lastReply.author.name ?? undefined}
            />
          )}
          <span {...stylex.props(styles.author)}>
            {lastReply.author.name || t('deletedMember')}
          </span>
          <span {...stylex.props(styles.preview)}>
            {lastReply.content.split('\n')[0] || t('reply.attachment')}
          </span>
          <time
            dateTime={new Date(lastReply.createdAt).toISOString()}
            {...stylex.props(styles.time)}
          >
            {dayjs(lastReply.createdAt).fromNow()}
          </time>
        </span>
      )}
    </button>
  );
};
