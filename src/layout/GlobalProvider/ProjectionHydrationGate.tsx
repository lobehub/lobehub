'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';

import { useCacheScope } from '@/libs/swr/useCacheScope';
import { buildAccountProjectionScope, useProjectionStore } from '@/projection';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { ensureProjectionLegacyBridge, syncProjectionLegacyStores } from './projectionLegacyBridge';

/**
 * Prepares trusted identity partitions before the first application surface
 * mounts. Entity data is intentionally not loaded here: each mounted surface
 * hydrates its bounded View Contract. Later identity changes close the gate
 * synchronously until both new partitions are ready, so neither scoped
 * selectors nor compatibility stores expose the previous identity for a
 * transition frame.
 */
const ProjectionHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const userId = useUserStore(userProfileSelectors.userId);
  const accountScope = userId ? buildAccountProjectionScope(userId) : scope;
  const prepareProjectionScope = useProjectionStore((state) => state.prepareProjectionScope);
  const scopesReady = useProjectionStore(
    (state) =>
      state.scopes[scope]?.hydrationStatus === 'ready' &&
      state.scopes[accountScope]?.hydrationStatus === 'ready',
  );
  const scopeKey = `${scope}\u0000${accountScope}`;
  const [releasedScopeKey, setReleasedScopeKey] = useState<string | undefined>(() =>
    scopesReady ? scopeKey : undefined,
  );

  useEffect(() => {
    ensureProjectionLegacyBridge();
    syncProjectionLegacyStores(scope);
    const prepare = async () => {
      await Promise.all([
        prepareProjectionScope(scope),
        ...(accountScope === scope ? [] : [prepareProjectionScope(accountScope)]),
      ]);
      syncProjectionLegacyStores(scope);
    };
    void prepare();
  }, [accountScope, prepareProjectionScope, scope]);

  useEffect(() => {
    if (scopesReady) setReleasedScopeKey(scopeKey);
  }, [scopeKey, scopesReady]);

  // A scope transition must close the gate synchronously. The effects above
  // then reset the compatibility stores, prepare the new partitions, and release only
  // after both scopes are ready; children never receive one render of the
  // previous workspace's materialized state.
  if (releasedScopeKey !== scopeKey || !scopesReady) return null;
  return <>{children}</>;
};

export default ProjectionHydrationGate;
