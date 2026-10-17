import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { getTaskStoreState } from '@/store/task';
import { TASK_COLLECTION_PAGE_SIZE } from '@/store/task/slices/list/action';

// Route loaders run before React commits the route: the only point where the
// persisted scheduled page (an async read) can land before the Tasks page
// paints its loading state. Only the scheduled tab reads it, and a reload
// always opens that tab on its first page.
export const scheduledTaskListLoader = async ({
  params,
  request,
}: Pick<LoaderFunctionArgs, 'params' | 'request'>): Promise<null> => {
  if (new URL(request.url).searchParams.get('collection') !== 'scheduled') return null;

  await settleWithin(
    getTaskStoreState().preHydrateScheduledTaskList({
      agentId: params.aid,
      limit: TASK_COLLECTION_PAGE_SIZE,
      offset: 0,
      projectId: params.projectId,
    }),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
