import { type SidebarAgentItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { SessionDefaultGroup } from '@/types/session';

import { useCreateMenuItems } from '../../../hooks';
import GroupItem from './AgentGroupItem';
import AgentItem from './AgentItem';

interface SessionListProps {
  dataSource: SidebarAgentItem[];
  groupId?: string;
  itemClassName?: string;
  itemStyle?: CSSProperties;
  onMoreClick?: () => void;
}

const List = memo<SessionListProps>(
  ({ onMoreClick, dataSource, groupId, itemStyle, itemClassName }) => {
    const { t } = useTranslation('chat');
    const { createAgent } = useCreateMenuItems();

    // Early return for empty state
    const isEmpty = useMemo(() => dataSource.length === 0, [dataSource.length]);

    // Check if this is defaultList and if there are more agents
    const isDefaultList = groupId === SessionDefaultGroup.Default;
    const ungroupedAgentsCount = useHomeStore(homeAgentListSelectors.ungroupedAgentsCount);
    const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
    const openAllAgentsDrawer = useHomeStore((s) => s.openAllAgentsDrawer);

    const hasMore = isDefaultList && ungroupedAgentsCount > agentPageSize;

    if (isEmpty) {
      return (
        <EmptyNavItem
          className={itemClassName}
          title={t('emptyAgentAction')}
          onClick={() => createAgent({ groupId })}
        />
      );
    }

    return (
      <Flexbox gap={1}>
        {dataSource.map((item) =>
          item.type === 'group' ? (
            <GroupItem className={itemClassName} item={item} key={item.id} style={itemStyle} />
          ) : (
            <AgentItem className={itemClassName} item={item} key={item.id} style={itemStyle} />
          ),
        )}
        {hasMore && (
          <NavItem
            icon={MoreHorizontal}
            title={t('input.more')}
            onClick={onMoreClick || openAllAgentsDrawer}
          />
        )}
      </Flexbox>
    );
  },
);

export default List;
