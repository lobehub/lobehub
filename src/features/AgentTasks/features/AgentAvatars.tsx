import { DEFAULT_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import type { TaskParticipant } from '@lobechat/types/src/task';
import { Avatar } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

interface AgentAvatarsProps {
  agents: TaskParticipant[];
  size?: number;
}

const AgentAvatars = memo<AgentAvatarsProps>(({ agents, size = 22 }) => {
  const { t } = useTranslation('common');
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  if (agents.length === 0) return null;

  return (
    <Avatar.Group
      shape={'circle'}
      size={size}
      variant={'outlined'}
      items={agents.map((agent, index) => {
        const isInbox =
          agent?.id === INBOX_SESSION_ID || (!!inboxAgentId && agent?.id === inboxAgentId);
        return {
          avatar: agent?.avatar || (isInbox ? DEFAULT_INBOX_AVATAR : DEFAULT_AVATAR),
          background: agent?.backgroundColor || cssVar.colorBgContainer,
          key: agent.id || index.toString(),
          title: agent?.title || (isInbox ? 'Lobe AI' : t('defaultSession')),
        };
      })}
    />
  );
});

export default AgentAvatars;
