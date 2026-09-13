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

  // `slugTitle`, not `title`: the displayed title falls back to the task's
  // instruction, and feeding that into the path would publish a prompt body to
  // browser history, analytics and every copied link. `slugTitle` is the task's
  // own name, which is also what the detail page canonicalises to — so the slug
  // this link carries survives arrival instead of being rewritten.
  const route =
    item.type === 'task'
      ? taskDetailPath(item.id, item.agentId ?? undefined, item.slugTitle)
      : item.routePath;

  return (
    <WorkspaceLink style={{ color: 'inherit', textDecoration: 'none' }} to={route}>
      <RecentListItem {...item} />
    </WorkspaceLink>
  );
});

ConnectedItem.displayName = 'ConnectedRecentItem';

export default ConnectedItem;
