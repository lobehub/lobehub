import { normalizeTaskListFilter } from '@lobechat/types';
import type { LoaderFunctionArgs } from 'react-router';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { taskListFilterScopeKey } from '@/features/AgentTasks/AgentTaskList/filter/taskFilterState';
import { normalizeTaskListViewOptions } from '@/features/AgentTasks/AgentTaskList/listViewOptions';
import { getMyTaskListOptions } from '@/features/AgentTasks/AgentTaskList/myTaskListOptions';
import {
  resolveMyTaskScope,
  resolveTaskCollection,
} from '@/features/AgentTasks/shared/taskCollection';
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { getTaskStoreState } from '@/store/task';
import {
  SCHEDULED_TASK_RECENT_RUNS,
  TASK_COLLECTION_PAGE_SIZE,
} from '@/store/task/slices/list/action';

/**
 * Seed the persisted first page of "My tasks" with the exact options the page
 * syncs on its first render, read from the same global status. Without it the
 * page paints its skeleton until the replica's own (post-commit) IndexedDB read
 * lands. A board view fetches server groups instead of this list, and the
 * page's member-field picking can still narrow a stored filter — either way the
 * page falls back to its own hydrate, never to a wrong entry.
 */
const preHydrateMyTaskList = (searchParams: URLSearchParams) => {
  const status = useGlobalStore.getState();
  // Mirrors `resolveTaskCollectionView`: "My tasks" renders a board in kanban mode.
  if (systemStatusSelectors.taskListViewMode(status) === 'kanban') return;

  const filter = systemStatusSelectors.taskListFilter(
    taskListFilterScopeKey({ workspaceId: getActiveWorkspaceId() }),
  )(status);

  return getTaskStoreState().preHydrateMyTaskList(
    getMyTaskListOptions({
      filter: normalizeTaskListFilter(filter),
      page: 1,
      scope: resolveMyTaskScope(searchParams),
      viewOptions: normalizeTaskListViewOptions(systemStatusSelectors.taskListViewOptions(status)),
    }),
  );
};

// Route loaders run before React commits the route: the only point where a
// persisted list page (an async read) can land before the Tasks page paints its
// loading state. Only the paginated tabs are seeded, always on their first
// page — the page resets to it whenever the route mounts.
export const taskListLoader = async ({
  params,
  request,
}: Pick<LoaderFunctionArgs, 'params' | 'request'>): Promise<null> => {
  // The URL → workspace switch runs after the route commits, so while the URL
  // enters another workspace the active scope is still the one being left;
  // reading it would seed the wrong partition. Leave that to the page's sync.
  if ((params.workspaceSlug ?? null) !== getActiveWorkspaceSlug()) return null;

  const { searchParams } = new URL(request.url);
  // Same gate as the page: "My tasks" exists only on a workspace's global page.
  const allowMine = !!getActiveWorkspaceId() && !params.aid && !params.projectId;
  const collection = resolveTaskCollection(searchParams, { allowMine });

  const hydration =
    collection === 'scheduled'
      ? getTaskStoreState().preHydrateScheduledTaskList({
          agentId: params.aid,
          limit: TASK_COLLECTION_PAGE_SIZE,
          offset: 0,
          projectId: params.projectId,
          recentRuns: SCHEDULED_TASK_RECENT_RUNS,
        })
      : collection === 'mine'
        ? preHydrateMyTaskList(searchParams)
        : undefined;

  if (hydration) await settleWithin(hydration, PRE_PAINT_HYDRATE_TIMEOUT);

  return null;
};
