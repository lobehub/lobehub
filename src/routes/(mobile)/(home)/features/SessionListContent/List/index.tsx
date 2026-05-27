import type { SidebarAgentItem } from '@lobechat/types';
import { useAnalytics } from '@lobehub/analytics/react';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import LazyLoad from 'react-lazy-load';
import { Link } from 'react-router-dom';

import { SESSION_CHAT_URL } from '@/const/index';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import SkeletonList from '../../SkeletonList';
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
  const { analytics } = useAnalytics();

  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const mobile = useServerConfigStore((s) => s.isMobile);

  const navigateToAgent = useNavigateToAgent();

  const isEmpty = !dataSource || dataSource.length === 0;
  return !isInit ? (
    <SkeletonList />
  ) : !isEmpty ? (
    dataSource.map((item) => (
      <LazyLoad className={styles} key={item.id}>
        <Link
          aria-label={item.id}
          to={SESSION_CHAT_URL(item.id, mobile)}
          onClick={(e) => {
            e.preventDefault();
            navigateToAgent(item.id);

            // Enhanced analytics tracking
            if (analytics) {
              const userStore = getUserStoreState();

              const userId = userProfileSelectors.userId(userStore);
              analytics?.track({
                name: 'switch_session',
                properties: {
                  assistant_name: item.title || 'Untitled Agent',
                  assistant_tags: [],
                  group_id: groupId || 'default',
                  group_name: groupId || 'Default',
                  session_id: item.id,
                  spm: 'homepage.chat.session_list_item.click',
                  user_id: userId || 'anonymous',
                },
              });
            }
          }}
        >
          <AgentItem groupId={groupId} item={item} />
        </Link>
      </LazyLoad>
    ))
  ) : (
    showAddButton && <AddButton groupId={groupId} />
  );
});

export default AgentList;
