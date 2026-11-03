import { isTRPCClientError } from '@trpc/client';

import type { TrpcClient } from '../../api/client';
import { isOperationToken, isOperationTokenRefusal } from '../../api/operationTokenFallback';

export interface TranscriptQuery {
  includeMessages: boolean;
  limit: number;
  offset: number;
  topicId: string;
}

/** A server that predates the operation route answers this for the unknown path. */
const isMissingProcedure = (error: unknown) =>
  isTRPCClientError(error) && error.message.startsWith('No procedure found on path');

/**
 * Read a topic the way `lh topic view` shows it.
 *
 * A device-dispatched run holds an operation token, which the ordinary route
 * refuses. It reads through `topic.getTopicTranscriptOperation` instead, as the
 * run's own principal, limited to its own conversation and the ones the user
 * names in it. When that route cannot serve the read — a server without it, a
 * topic outside that boundary, a run that already ended — the ordinary route is
 * tried, which on a machine logged in as the same account still answers (see
 * `operationTokenFallback`). If the ordinary route only repeats the operation
 * token refusal, the operation route's own answer is the one worth showing.
 *
 * `--workspace` names a scope the run's token was not minted for, so it always
 * takes the ordinary route.
 */
export const readTopicTranscript = async (
  client: TrpcClient,
  query: TranscriptQuery,
  explicitWorkspace?: string,
) => {
  if (explicitWorkspace || !isOperationToken(process.env.LOBEHUB_JWT)) {
    return client.topic.getTopicTranscript.query(query);
  }

  try {
    return await client.topic.getTopicTranscriptOperation.query(query);
  } catch (operationError) {
    const notFound = isTRPCClientError(operationError) && operationError.data?.code === 'NOT_FOUND';
    if (notFound && !isMissingProcedure(operationError)) throw operationError;

    try {
      return await client.topic.getTopicTranscript.query(query);
    } catch (userRouteError) {
      throw isOperationTokenRefusal(userRouteError) && !isMissingProcedure(operationError)
        ? operationError
        : userRouteError;
    }
  }
};
