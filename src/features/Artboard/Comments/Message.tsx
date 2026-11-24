import type { ArtboardCommentView } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BotIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { artboardTokens } from '../tokens.stylex';

const styles = stylex.create({
  agent: {
    backgroundColor: artboardTokens.agent,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: artboardTokens.human,
    borderRadius: '50%',
    color: cssVar.colorWhite,
    display: 'flex',
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 600,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  text: {
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  time: {
    color: cssVar.colorTextQuaternary,
    fontWeight: 400,
  },
  who: {
    alignItems: 'center',
    display: 'flex',
    fontSize: 11,
    fontWeight: 600,
    gap: 7,
    marginBlockEnd: 2,
  },
});

const timeOf = (value: Date | string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const Message = ({ comment }: { comment: ArtboardCommentView }) => {
  const { t } = useTranslation('project');
  const me = useUserStore(userProfileSelectors.userId);
  const agent = !!comment.authorAgentId;
  const name = agent
    ? t('artboard.comment.agent')
    : comment.authorUserId === me
      ? t('artboard.comment.you')
      : t('artboard.comment.member');

  return (
    <div>
      <div {...stylex.props(styles.who)}>
        <span {...stylex.props(styles.avatar, agent && styles.agent)}>
          {agent ? <Icon icon={BotIcon} size={12} /> : [...name][0]}
        </span>
        {name}
        <span {...stylex.props(styles.time)}>{timeOf(comment.createdAt)}</span>
      </div>
      <div {...stylex.props(styles.text)}>{comment.content}</div>
    </div>
  );
};

export default Message;
