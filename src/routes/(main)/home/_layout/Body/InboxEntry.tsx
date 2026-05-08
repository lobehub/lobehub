'use client';

import { DEFAULT_INBOX_AVATAR, SESSION_CHAT_URL } from '@lobechat/const';
import { Avatar, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { isModifierClick } from '@/utils/navigation';

const styles = createStaticStyles(({ css, cssVar }) => ({
  runningBadge: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -3px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
    border: 1.5px solid ${cssVar.colorBgContainer};
    border-radius: 999px;

    color: ${cssVar.colorWarning};

    background: ${cssVar.colorBgContainer};
  `,
  wrapper: css`
    position: relative;
    display: inline-flex;
  `,
}));

const InboxEntry = memo(() => {
  const navigate = useNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxAgentId!));
  const isLoading = useChatStore(
    inboxAgentId ? operationSelectors.isAgentRunning(inboxAgentId) : () => false,
  );

  const title = inboxMeta.title || 'Lobe AI';
  const avatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;
  const url = SESSION_CHAT_URL(inboxAgentId, false);

  const avatarNode = <Avatar emojiScaleWithBackground avatar={avatar} shape={'square'} size={24} />;

  return (
    <Link
      aria-label={title}
      to={url}
      onClick={(e) => {
        if (isModifierClick(e)) return;
        e.preventDefault();
        navigate(url);
      }}
    >
      <NavItem
        title={title}
        icon={
          isLoading ? (
            <span className={styles.wrapper}>
              {avatarNode}
              <span className={styles.runningBadge}>
                <Icon spin icon={Loader2} size={9} />
              </span>
            </span>
          ) : (
            avatarNode
          )
        }
      />
    </Link>
  );
});

export default InboxEntry;
