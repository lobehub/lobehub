import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const MemberCountTag = memo(() => {
  const { t } = useTranslation('chat');
  const currentGroupAgents = useAgentGroupStore(agentGroupSelectors.currentGroupAgents);

  const memberCount = currentGroupAgents?.length ?? 0;

  if (memberCount <= 0) return null;

  return (
    <Tooltip title={t('group.memberTooltip', { count: memberCount })}>
      <Flexbox height={22}>
        <Tag>
          <Icon icon={Users} />
          <span>{memberCount}</span>
        </Tag>
      </Flexbox>
    </Tooltip>
  );
});

export default MemberCountTag;
