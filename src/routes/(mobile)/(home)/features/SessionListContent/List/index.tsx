import { useAnalytics } from '@lobehub/analytics/react';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import LazyLoad from 'react-lazy-load';
import { Link } from 'react-router';

import { AGENT_CHAT_URL } from '@/const/index';
import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { type LobeSessions } from '@/types/session';

import SkeletonList from '../../SkeletonList';
import AddButton from './AddButton';
import SessionItem from './Item';

const styles = createStaticStyles(
  ({ css }) => css`
    min-height: 70px;
  `,
);
interface SessionListProps {
  dataSource?: LobeSessions;
  groupId?: string;
  showAddButton?: boolean;
}
const SessionList = memo<SessionListProps>(({ dataSource, groupId, showAddButton = true }) => {
  const { analytics } = useAnalytics();

  const isInit = useSessionStore(sessionSelectors.isSessionListInit);
  const mobile = useServerConfigStore((s) => s.isMobile);

  const navigateToAgent = useNavigateToAgent();

  const isEmpty = !dataSource || dataSource.length === 0;
  return !isInit ? (
    <SkeletonList />
  ) : !isEmpty ? (
    dataSource.map(({ id, ...res }) => (
      <LazyLoad className={styles} key={id}>
        <Link
          aria-label={id}
          to={AGENT_CHAT_URL((res as any).config?.id, mobile)}
          onClick={(e) => {
            e.preventDefault();
            navigateToAgent((res as any).config?.id);

            if (analytics) {
              // Privacy boundary: session switching is an anonymous action metric. Never attach
              // account/session IDs, group names, or user-authored Agent metadata.
              analytics.track({
                name: 'switch_session',
                properties: {
                  spm: 'homepage.chat.session_list_item.click',
                },
              });
            }
          }}
        >
          <SessionItem id={id} />
        </Link>
      </LazyLoad>
    ))
  ) : (
    showAddButton && <AddButton groupId={groupId} />
  );
});

export default SessionList;
