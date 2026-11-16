import { isTRPCClientError } from '@trpc/client';

import { parseJwtPayload } from '../auth/source';

/**
 * A device-dispatched run (desktop gateway, `lh connect`) authenticates with
 * the run's `hetero-operation` token in `LOBEHUB_JWT`. A server that mints it
 * with `caller:act` accepts it on user routes as the user who started the run;
 * an older server answers those routes with this refusal.
 *
 * `lh` never answers a refusal by switching to this machine's own login: on a
 * shared device that login can belong to someone else, and the server alone
 * decides what a run may do.
 */
export const OPERATION_TOKEN_REFUSAL = 'hetero-operation tokens are not accepted on this endpoint';

export const isOperationToken = (token: string | undefined): boolean =>
  !!token && parseJwtPayload(token)?.purpose === 'hetero-operation';

export const isOperationTokenRefusal = (error: unknown): boolean =>
  isTRPCClientError(error) &&
  error.data?.code === 'UNAUTHORIZED' &&
  error.message === OPERATION_TOKEN_REFUSAL;
