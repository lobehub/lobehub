import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import LazyLoad from 'react-lazy-load';
import { Link } from 'react-router';

import { AGENT_CHAT_URL } from '@/const/index';
import { type SidebarAgentItem } from '@/database/repositories/home';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useServerConfigStore } from '@/store/serverConfig';

import AddButton from './AddButton';
import AgentItem from './Item';

const styles = createStaticStyles(
  ({ css }) => css`
    min-height: 70px;
  `,
);

interface AgentListProps {
  dataSource?: SidebarAgentItem[];
  groupId?: string;
  showAddButton?: boolean;
}

const AgentList = memo<AgentListProps>(({ dataSource, groupId, showAddButton = true }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const navigateToAgent = useNavigateToAgent();

  const isEmpty = !dataSource || dataSource.length === 0;
  return !isEmpty
    ? dataSource.map(({ id }) => (
        <LazyLoad className={styles} key={id}>
          <Link
            aria-label={id}
            to={AGENT_CHAT_URL(id, mobile)}
            onClick={(e) => {
              e.preventDefault();
              navigateToAgent(id);
            }}
          >
            <AgentItem groupId={groupId} id={id} />
          </Link>
        </LazyLoad>
      ))
    : showAddButton && <AddButton groupId={groupId} />;
});

export default AgentList;
