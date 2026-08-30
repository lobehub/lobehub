import { memo } from 'react';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';
import type { RecentEntityRef } from '@/store/home/slices/recent/initialState';

import RecentListItem from './Item';

interface ConnectedItemProps {
  itemRef: RecentEntityRef;
  queryKey: string;
  scope: string;
}

const ConnectedItem = memo<ConnectedItemProps>(({ itemRef, queryKey, scope }) => {
  const item = useHomeStore(homeRecentSelectors.item(scope, queryKey, itemRef));
  if (!item) return null;

  const route =
    item.type === 'task' ? taskDetailPath(item.id, item.agentId ?? undefined) : item.routePath;

  return (
    <WorkspaceLink style={{ color: 'inherit', textDecoration: 'none' }} to={route}>
      <RecentListItem {...item} />
    </WorkspaceLink>
  );
});

ConnectedItem.displayName = 'ConnectedRecentItem';

export default ConnectedItem;
