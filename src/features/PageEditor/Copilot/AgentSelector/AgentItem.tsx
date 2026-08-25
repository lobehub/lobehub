import {
  type AgentNameFields,
  agentSecondaryDisplayName,
  type GroupMemberAvatar,
} from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/features/HomeSidebar/Body/Agent/List/AgentItem/Avatar';
import NavItem from '@/features/NavPanel/components/NavItem';

interface AgentItemProps {
  active: boolean;
  /**
   * Identity fields of the agent, used to resolve the role shown beside its
   * name. Omit for rows that have no agent record behind them.
   */
  agent?: AgentNameFields | null;
  agentId: string;
  agentTitle: string;
  avatar: string | GroupMemberAvatar[] | null | undefined;
  onAgentChange: (agentId: string) => void;
  onClose: () => void;
}

const AgentItem = memo<AgentItemProps>(
  ({ active, agent, agentId, agentTitle, avatar, onAgentChange, onClose }) => {
    const { t } = useTranslation('chat');

    const title = agentTitle || t('untitledAgent');
    // Same name + muted role treatment as the sidebar's agent list, so a row
    // reads identically wherever an agent is listed.
    const roleTag = agentSecondaryDisplayName(agent);

    return (
      <NavItem
        active={active}
        icon={<AgentAvatar avatar={typeof avatar === 'string' ? avatar : undefined} />}
        style={{ flexShrink: 0 }}
        title={
          roleTag ? (
            <>
              {title}
              <span style={{ fontSize: 12, marginInlineStart: 6, opacity: 0.6 }}>{roleTag}</span>
            </>
          ) : (
            title
          )
        }
        onClick={() => {
          onAgentChange(agentId);
          onClose();
        }}
      />
    );
  },
);

export default AgentItem;
