import type { Operation, TRPCLink } from '@trpc/client';
import { isTRPCClientError } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';

import { describeTokenLookup, getValidToken } from '../auth/refresh';
import { parseJwtPayload } from '../auth/source';
import { log } from '../utils/logger';

/**
 * Device-dispatched runs (desktop gateway, `lh connect`) carry the run's narrow
 * `hetero-operation` token in `LOBEHUB_JWT`. It is accepted by the operation
 * endpoints (`heteroIngest`, `goal.*Operation`, …) and refused by every
 * user-scoped one, while it still outranks the machine's stored login. So an
 * agent's `lh doc` / `lh kb` / … failed until the agent itself cleared the
 * variable — an instruction the `lh` guide had to teach, and one an agent then
 * applied to errors it did not fit.
 *
 * The refusal is a fixed `oidcAuth` answer, so the client recognises exactly it
 * and re-sends that one request with the stored login — but only when that
 * login is the same account the operation token was minted for. A workspace
 * device is reachable by every member, so the machine's login can belong to
 * someone other than the member whose run this is; borrowing it would read and
 * write that person's data. Everything else is unchanged: operation endpoints
 * keep the operation token, and the workspace header stays the run's own scope
 * (`LOBEHUB_WORKSPACE_ID` or personal) — which the manual fallback did not do,
 * since an empty `LOBEHUB_JWT` re-enables the terminal's persisted
 * `lh workspace use` scope.
 *
 * Reads with an operation-authenticated route need neither: `lh topic view`
 * tries `topic.getTopicTranscriptOperation` first (`commands/topic/readTranscript`).
 */

/** `oidcAuth`'s message when an operation token reaches a user-scoped route. */
export const OPERATION_TOKEN_REFUSAL = 'hetero-operation tokens are not accepted on this endpoint';

/** Operation-context key carrying the stored login on the request the link re-sends. */
const STORED_LOGIN = 'storedLogin';

export const isOperationToken = (token: string | undefined): boolean =>
  !!token && parseJwtPayload(token)?.purpose === 'hetero-operation';

const subjectOf = (token: string) => {
  const sub = parseJwtPayload(token)?.sub;
  return typeof sub === 'string' && sub ? sub : undefined;
};

export const isOperationTokenRefusal = (error: unknown): boolean =>
  isTRPCClientError(error) &&
  error.data?.code === 'UNAUTHORIZED' &&
  error.message === OPERATION_TOKEN_REFUSAL;

/**
 * The stored login, when it is usable and belongs to the operation token's own
 * account.
 */
export const storedLoginFor = async (
  operationToken: string,
): Promise<{ token: string } | { warning: string }> => {
  const result = await getValidToken();
  if (result.status === 'ok') {
    const owner = subjectOf(operationToken);
    const stored = result.credentials.accessToken;
    if (owner && subjectOf(stored) === owner) return { token: stored };
  }

  const report = describeTokenLookup(result);
  return {
    warning: report
      ? `${report.detail} ${report.fix}`
      : "LOBEHUB_JWT is this run's operation token, which this endpoint refuses, and this machine has no stored login of the same account to use instead.",
  };
};

/**
 * Re-send a request whose operation token was refused, once, with the stored
 * login of the same account. Without one, say why instead of re-sending a
 * request that can only be refused again.
 */
export const operationTokenFallbackLink =
  <TRouter extends AnyRouter>(operationToken: () => string): TRPCLink<TRouter> =>
  () =>
  ({ next, op }) =>
    observable((observer) => {
      let closed = false;
      let subscription = next(op).subscribe({
        complete: () => observer.complete(),
        error: (error) => {
          if (op.context[STORED_LOGIN] || !isOperationTokenRefusal(error)) {
            observer.error(error);
            return;
          }
          void storedLoginFor(operationToken())
            .then((lookup) => {
              if (closed) return;
              if ('warning' in lookup) {
                log.warn(lookup.warning);
                observer.error(error);
                return;
              }
              log.debug(`${op.path}: operation token refused, retrying with the stored login`);
              subscription = next({
                ...op,
                context: { ...op.context, [STORED_LOGIN]: lookup.token },
              }).subscribe(observer);
            })
            .catch((lookupError: unknown) => {
              if (closed) return;
              log.warn(
                `Could not look up the stored login: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}`,
              );
              observer.error(error);
            });
        },
        next: (value) => observer.next(value),
      });

      return () => {
        closed = true;
        subscription.unsubscribe();
      };
    });

/**
 * Auth headers for a client holding an operation token: the token itself, or
 * the stored login `operationTokenFallbackLink` attached to a re-sent request.
 */
export const operationTokenHeaders =
  (operationToken: () => string) =>
  (opts?: { op?: Operation }): Record<string, string> => {
    const stored = opts?.op?.context[STORED_LOGIN];
    return { 'Oidc-Auth': typeof stored === 'string' ? stored : operationToken() };
  };
