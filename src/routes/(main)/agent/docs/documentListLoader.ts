import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { agentDocumentActions } from '@/store/agentDocument';

/**
 * Route loader for the agent documents surface (`/agent/:aid/docs/*`).
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted document list (an async IndexedDB read) can land before the docs
 * sidebar paints its loading spinner.
 */
export const agentDocumentListLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  await settleWithin(
    agentDocumentActions.preHydrateDocumentList(params.aid),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
