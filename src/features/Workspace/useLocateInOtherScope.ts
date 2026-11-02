'use client';

import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';
import { useClientDataSWR } from '@/libs/swr';
import { normalizeAsyncError } from '@/libs/swr/normalizeError';
import { createWorkspaceLambdaClient } from '@/libs/trpc/client';

export type ScopedLambdaClient = ReturnType<typeof createWorkspaceLambdaClient>;

/** A scope the user can switch to: personal (`id: null`) or one of their workspaces. */
export interface OtherScope {
  id: string | null;
  name?: string;
  slug?: string;
}

/**
 * Rewrite `pathname` (which may carry the active workspace's slug) into the
 * same route under `target`: `/{slug}/goal/x` ⇄ `/goal/x`.
 */
export const buildOtherScopePath = (
  pathname: string,
  activeSlug: string | null | undefined,
  target: Pick<OtherScope, 'slug'>,
): string => {
  const isPrefixed =
    !!activeSlug && (pathname === `/${activeSlug}` || pathname.startsWith(`/${activeSlug}/`));
  const bare = isPrefixed ? pathname.slice(activeSlug!.length + 1) || '/' : pathname;

  if (!target.slug) return bare;
  return bare === '/' ? `/${target.slug}` : `/${target.slug}${bare}`;
};

/**
 * Reads the resource through a client pinned to one candidate scope and
 * rejects when it is not visible there. Pass `signal` on to the request so a
 * probe that is no longer needed can be cancelled.
 */
export type ScopeProbe = (client: ScopedLambdaClient, signal: AbortSignal) => Promise<unknown>;

/** Probes in flight at once. A user in many workspaces must not fan out one read per workspace. */
export const SCOPE_PROBE_CONCURRENCY = 3;

/**
 * Deadline for the whole cross-scope check. A probe that never settles must not
 * hold the page on its loading frame: past this, the check counts as "not
 * found" and the page falls back to the original error and its Retry.
 */
export const SCOPE_PROBE_TIMEOUT_MS = 10_000;

/**
 * Find the first candidate scope `probe` succeeds in. Candidates start in order
 * (personal first) with at most {@link SCOPE_PROBE_CONCURRENCY} in flight; the
 * first success aborts the rest and starts no more. Resolves `null` when every
 * candidate misses or {@link SCOPE_PROBE_TIMEOUT_MS} passes first.
 */
export const probeScopes = (candidates: OtherScope[], probe: ScopeProbe) =>
  new Promise<OtherScope | null>((resolve) => {
    const controller = new AbortController();
    let settled = false;
    let inFlight = 0;
    let next = 0;

    const settle = (scope: OtherScope | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      controller.abort();
      resolve(scope);
    };
    const deadline = setTimeout(() => settle(null), SCOPE_PROBE_TIMEOUT_MS);

    const launch = () => {
      while (!settled && inFlight < SCOPE_PROBE_CONCURRENCY && next < candidates.length) {
        const scope = candidates[next++];
        inFlight++;
        Promise.resolve()
          .then(() => probe(createWorkspaceLambdaClient(scope.id), controller.signal))
          .then(
            () => settle(scope),
            // Not visible in this scope (or aborted); the next candidate takes the slot.
            () => {},
          )
          .finally(() => {
            inFlight--;
            if (settled) return;
            if (next >= candidates.length && inFlight === 0) settle(null);
            else launch();
          });
      }
    };

    if (candidates.length === 0) settle(null);
    else launch();
  });

/**
 * After a read 404s in the active scope, find which of the user's OTHER scopes
 * (personal or another workspace) the resource lives in, so the page can offer
 * a switch instead of a dead "Failed to load". Rows are scoped server-side by
 * the `X-Workspace-Id` header, so the same id legitimately 404s in every scope
 * but its own.
 *
 * `probe` must reject when the resource is not visible through the given
 * client. Pass a `null` key to skip (e.g. the error is not a 404).
 */
export const useLocateInOtherScope = (key: string | null, probe: ScopeProbe) => {
  const activeId = useActiveWorkspaceId();
  const workspaces = useWorkspaces();

  const candidates = useMemo<OtherScope[]>(
    () => [
      ...(activeId ? [{ id: null }] : []),
      ...workspaces
        .filter((ws) => ws.id !== activeId && !ws.lockedOut)
        .map((ws) => ({ id: ws.id, name: ws.name, slug: ws.slug })),
    ],
    [activeId, workspaces],
  );

  return useClientDataSWR<OtherScope | null>(
    key && candidates.length > 0
      ? ['locateInOtherScope', key, candidates.map((c) => c.id ?? 'personal').join(',')]
      : null,
    () => probeScopes(candidates, probe),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
};

export interface OtherScopeRecovery {
  /** Still probing; show a loading frame rather than flash the generic error. */
  pending: boolean;
  /** The scope that holds the resource, when one was found. */
  scope?: OtherScope;
  /** The current route rewritten into `scope`, query string kept. */
  targetPath?: string;
}

/**
 * Turns a detail page's read `error` into a way out: on a 404, locate the
 * resource in the user's other scopes and build the same route there.
 */
export const useOtherScopeRecovery = (
  error: unknown,
  key: string,
  probe: ScopeProbe,
): OtherScopeRecovery => {
  const { pathname, search } = useLocation();
  const activeSlug = useActiveWorkspaceSlug();

  const isNotFound = normalizeAsyncError(error).status === 404;
  const { data: scope, isLoading } = useLocateInOtherScope(isNotFound ? key : null, probe);

  if (isNotFound && isLoading) return { pending: true };
  if (!scope) return { pending: false };

  return {
    pending: false,
    scope,
    targetPath: buildOtherScopePath(pathname, activeSlug, scope) + search,
  };
};
