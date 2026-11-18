import dayjs from 'dayjs';
import type { LoaderFunctionArgs } from 'react-router';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { getBriefStoreState } from '@/store/brief';

// Route loaders run before React commits the route: the only point where the
// persisted inbox (an async IndexedDB read) can land before Home paints its
// brief skeleton. A reload always opens the digest on today.
export const homeInboxLoader = async ({
  params,
}: Pick<LoaderFunctionArgs, 'params'>): Promise<null> => {
  // The URL → workspace switch runs after the route commits, so while the URL
  // enters another workspace the active scope is still the one being left;
  // reading it would seed the wrong partition. Leave that to the inbox's sync.
  if ((params.workspaceSlug ?? null) !== getActiveWorkspaceSlug()) return null;

  await settleWithin(
    getBriefStoreState().preHydrateInbox(dayjs().format('YYYY-MM-DD')),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
