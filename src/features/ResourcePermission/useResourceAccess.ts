import { useHasActiveWorkspace } from '@/business/client/hooks/useHasActiveWorkspace';
import { useClientDataSWR } from '@/libs/swr';
import { resourcePermissionKeys } from '@/libs/swr/keys';
import { getCacheScope, useIsScopeTrusted } from '@/libs/swr/useCacheScope';
import type { PermissionResourceType } from '@/services/resourcePermission';
import { resourcePermissionService } from '@/services/resourcePermission';
import { isTrpcErrorCode } from '@/utils/trpcError';

/**
 * Resources whose access record the server has returned during this page
 * session. The record itself is persisted, so a cached value can predate a
 * downgrade; only a record re-fetched since boot is trusted for management.
 *
 * Keyed by the cache scope (user + workspace) too: switching identity swaps
 * the persisted partition without a reload, and a confirmation earned in one
 * scope must not vouch for another scope's cached record of the same id.
 *
 * The value is the generation of the newest confirming request, so a consumer
 * can tell a confirmation it waited for from one earned earlier in the session.
 */
const confirmedThisSession = new Map<string, number>();

/**
 * Monotonic counter bumped as each access request is issued. Unlike wall-clock
 * milliseconds it orders requests causally: a request issued after a consumer
 * read `getAccessRequestGeneration()` always carries a strictly larger value.
 */
let requestGeneration = 0;

/** The generation of the most recently issued access request. */
export const getAccessRequestGeneration = () => requestGeneration;

/**
 * Resources whose latest refresh this session the server denied (see
 * `isAccessDenialError`). SWR keeps the previous record through that failed
 * refresh, so these fail every check closed until a later fetch succeeds.
 */
const deniedThisSession = new Set<string>();

const sessionKey = (scope: string, resourceType: PermissionResourceType, resourceId: string) =>
  `${scope}|${resourceType}:${resourceId}`;

/** Thrown when the cache scope changed while an access request was in flight. */
export class AccessScopeChangedError extends Error {
  constructor() {
    super('Cache scope changed before the access record settled');
    this.name = 'AccessScopeChangedError';
  }
}

/**
 * Refresh failures that are the server's answer rather than a transport fault:
 * the resource went private, left the workspace, or the caller lost access.
 */
const isAccessDenialError = (error: unknown) =>
  isTrpcErrorCode(error, 'NOT_FOUND') ||
  isTrpcErrorCode(error, 'FORBIDDEN') ||
  isTrpcErrorCode(error, 'UNAUTHORIZED');

/** A General-access record stamped with when this client last fetched it. */
export type FetchedGeneralAccess = Awaited<
  ReturnType<typeof resourcePermissionService.getGeneralAccess>
> & {
  /** Persisted rows age from this time (see `LOCAL_SNAPSHOT_PATTERNS`). */
  fetchedAt: number;
};

/** Stamp a server-returned record with its fetch time for the cache TTL. */
export const stampFetchedAccess = (
  record: Awaited<ReturnType<typeof resourcePermissionService.getGeneralAccess>>,
): FetchedGeneralAccess => ({ ...record, fetchedAt: Date.now() });

/** Fetch the General-access record and remember that this session confirmed it. */
export const fetchGeneralAccess = async (
  resourceType: PermissionResourceType,
  resourceId: string,
) => {
  // The scope the request was issued under, not whichever one is active when
  // it settles.
  const scope = getCacheScope();
  const key = sessionKey(scope, resourceType, resourceId);
  const generation = ++requestGeneration;
  let result: Awaited<ReturnType<typeof resourcePermissionService.getGeneralAccess>>;
  try {
    result = await resourcePermissionService.getGeneralAccess(resourceType, resourceId);
  } catch (error) {
    // SWR keeps the last record through a failed refresh. A transient fault
    // leaves this session's confirmation intact, but a denial means that
    // record no longer holds, so it must stop vouching for any access.
    if (isAccessDenialError(error)) {
      confirmedThisSession.delete(key);
      deniedThisSession.add(key);
    }
    throw error;
  }
  // The SWR key carries no user id, so after an in-place account switch the
  // previous user's answer would land in (and persist to) the new user's
  // partition. Reject it; the scope reload revalidates under the new identity.
  if (getCacheScope() !== scope) throw new AccessScopeChangedError();
  confirmedThisSession.set(key, Math.max(generation, confirmedThisSession.get(key) ?? 0));
  deniedThisSession.delete(key);
  return stampFetchedAccess(result);
};

/** Test-only: forget which records this session has confirmed. */
export const resetConfirmedAccessForTest = () => {
  confirmedThisSession.clear();
  deniedThisSession.clear();
  requestGeneration = 0;
};

/**
 * Read-side derivation of the workspace General-access level for a resource.
 *
 * Edit/use checks stay permissive while workspace access is loading so chat
 * input does not flash disabled. A server-confirmed creator/admin (`canManage`)
 * bypasses the public resource's Member Permissions. Management checks are
 * deliberately fail-closed: destructive/ownership controls must not appear
 * until that access is confirmed. Personal mode keeps full access.
 *
 * The access record is persisted (local cache tier), so after a reload edit/use
 * checks resolve from the last server-confirmed value while it revalidates.
 * `isAccessConfirmed` is only true once the current session has re-fetched it;
 * `confirmedGeneration` is the request generation that confirmed it.
 * Use it before acting on a denial (redirects); `canManageResource` already
 * requires it, so a cached manager grant the user has since lost never shows
 * management controls.
 */
export const useResourceAccess = (
  resourceType: PermissionResourceType,
  resourceId: string | undefined,
) => {
  const hasActiveWorkspace = useHasActiveWorkspace();
  const isScopeTrusted = useIsScopeTrusted();
  const enabled = hasActiveWorkspace && !!resourceId;

  // `isValidating` is read (and returned) so the hook re-renders when a
  // revalidation settles with an unchanged record — that is when the session
  // confirmation flips.
  const { data, error, isLoading, isValidating, mutate } = useClientDataSWR(
    enabled ? resourcePermissionKeys.generalAccess(resourceType, resourceId!) : null,
    () => fetchGeneralAccess(resourceType, resourceId!),
  );

  // A later transient refresh error keeps SWR's settled record, and this
  // session already fetched it successfully, so it stays confirmed; a record
  // never fetched this session (a cached grant from an earlier boot) or one the
  // server has since denied (`fetchGeneralAccess` drops it) is unconfirmed.
  const key = enabled ? sessionKey(getCacheScope(), resourceType, resourceId!) : '';
  const isAccessConfirmed = !enabled || (!!data && confirmedThisSession.has(key));
  // A server denial outranks the record SWR retained: nothing derived from it
  // may stay enabled, and the access counts as resolved (to "no access").
  const isDenied = enabled && deniedThisSession.has(key);

  return {
    accessError: error,
    canEditResource:
      !enabled || (!isDenied && (!data ? true : data.canManage || data.accessLevel === 'edit')),
    canManageResource: !enabled || (isAccessConfirmed && data?.canManage === true),
    canUseResource:
      !enabled || (!isDenied && (!data ? true : data.canManage || data.accessLevel !== 'view')),
    confirmedGeneration: isAccessConfirmed && enabled ? confirmedThisSession.get(key) : undefined,
    isAccessConfirmed,
    // Before the identity resolves, the cache partition is the last-known
    // user's guess: a cold boot with an expired session or an out-of-band
    // account switch would otherwise act on another account's cached record.
    isAccessResolved: !enabled || isDenied || (!!data && isScopeTrusted),
    isLoading,
    isValidating,
    retryAccess: mutate,
  };
};
