import { type GroupMemberAvatar } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import HeterogeneousTag from '@/features/HeterogeneousTag';
import NavItem from '@/features/NavPanel/components/NavItem';
import AgentAvatar from '@/routes/(main)/home/_layout/Body/Agent/List/AgentItem/Avatar';

interface AgentItemProps {
  active: boolean;
  agentId: string;
  agentTitle: string;
  avatar: string | GroupMemberAvatar[] | null | undefined;
  /** Heterogeneous runtime type (e.g. `claude-code`); shows a runtime tag when set. */
  heterogeneousType?: string | null;
  onAgentChange: (agentId: string) => void;
  onClose: () => void;
}

const AgentItem = memo<AgentItemProps>(
  ({ active, agentId, agentTitle, avatar, heterogeneousType, onAgentChange, onClose }) => {
    const { t } = useTranslation('chat');

    const title = agentTitle || t('untitledAgent');

    return (
      <NavItem
        active={active}
        icon={<AgentAvatar avatar={typeof avatar === 'string' ? avatar : undefined} />}
        style={{ flexShrink: 0 }}
        title={
          heterogeneousType ? (
            <Flexbox horizontal align={'center'} gap={4}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </span>
              <HeterogeneousTag type={heterogeneousType} />
            </Flexbox>
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
