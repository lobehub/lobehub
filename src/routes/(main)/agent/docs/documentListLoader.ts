import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { agentDocumentActions } from '@/store/agentDocument';
import { getIdFromIdentifier } from '@/utils/identifier';

/**
 * Route loader for the agent documents surface (`/agent/:aid/docs/*`).
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted document list (an async IndexedDB read) can land before the docs
 * sidebar paints its loading spinner. On a document route it also seeds that
 * document's chat topic id, so the floating chat panel opens on its
 * conversation without waiting for the get-or-create round-trip.
 */
export const agentDocumentListLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  const documentId = params.docId ? getIdFromIdentifier(params.docId, 'docs') : undefined;

  await settleWithin(
    Promise.all([
      agentDocumentActions.preHydrateDocumentList(params.aid),
      params.aid && documentId
        ? agentDocumentActions.preHydrateDocumentChatTopic({ agentId: params.aid, documentId })
        : false,
    ]),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
