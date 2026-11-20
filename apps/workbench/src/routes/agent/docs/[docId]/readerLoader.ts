import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { agentDocumentActions } from '@/store/agentDocument';
import { getIdFromIdentifier } from '@/utils/identifier';

import { enableWorkbenchIdentity } from '../../../../shell/workbenchReplicaScope';

/**
 * Route loader for the Workbench agent document reader.
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted reader body (an async IndexedDB read) can land before the reader
 * paints its content spinner. The route is private, so it opts into the
 * hydrate-then-verify partition first; otherwise the read is refused.
 */
export const agentDocumentReaderLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  void enableWorkbenchIdentity();
  if (!params.aid || !params.docId) return null;

  const agentId = getIdFromIdentifier(params.aid, 'agt');
  const documentId = getIdFromIdentifier(params.docId, 'docs');

  await settleWithin(
    agentDocumentActions.preHydrateReaderDocument({ agentId, documentId }),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
