import { type GroupMemberAvatar } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/app/[variants]/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';
import NavItem from '@/features/NavPanel/components/NavItem';

interface AgentItemProps {
  active: boolean;
  agentId: string;
  agentTitle: string;
  avatar: string | GroupMemberAvatar[] | null | undefined;
  onAgentChange: (agentId: string) => void;
  onClose: () => void;
}

const AgentItem = memo<AgentItemProps>(
  ({ active, agentId, agentTitle, avatar, onAgentChange, onClose }) => {
    const { t } = useTranslation('chat');

    return (
      <NavItem
        active={active}
        icon={<AgentAvatar avatar={typeof avatar === 'string' ? avatar : undefined} />}
        style={{ flexShrink: 0 }}
        title={agentTitle || t('untitledAgent')}
        onClick={() => {
          onAgentChange(agentId);
          onClose();
        }}
      />
    );
  },
);

export default AgentItem;
