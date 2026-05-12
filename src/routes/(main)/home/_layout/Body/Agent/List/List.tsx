import { type SidebarAgentItem } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { MoreHorizontal } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { SessionDefaultGroup } from '@/types/session';

import CreateAgentButton from '../CreateAgentButton';
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

    // Early return for empty state
    const isEmpty = useMemo(() => dataSource.length === 0, [dataSource.length]);

    // Check if this is defaultList and if there are more agents
    const isDefaultList = groupId === SessionDefaultGroup.Default;
    const ungroupedAgentsCount = useHomeStore(homeAgentListSelectors.ungroupedAgentsCount);
    const agentPageSize = useGlobalStore(systemStatusSelectors.agentPageSize);
    const openAllAgentsDrawer = useHomeStore((s) => s.openAllAgentsDrawer);

    const hasMore = isDefaultList && ungroupedAgentsCount > agentPageSize;

    // Empty custom/default groups always show the Create button so the user can populate them.
    // Non-empty lists only show it at the bottom of the default group; custom groups rely on
    // the group header dropdown for further additions.
    const showCreateButton = isEmpty ? groupId !== undefined : isDefaultList;

    if (isEmpty) {
      return showCreateButton ? (
        <CreateAgentButton className={itemClassName} groupId={groupId} />
      ) : null;
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
        {showCreateButton && <CreateAgentButton className={itemClassName} groupId={groupId} />}
      </Flexbox>
    );
  },
);

export default List;
