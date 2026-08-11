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
 * hydrates its bounded View Contract. Later scope changes prepare their own
 * empty partition without blanking the running application; every Projection
 * selector remains explicitly scoped, so a previous identity cannot leak.
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
  const [released, setReleased] = useState(scopesReady);

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
    if (scopesReady) setReleased(true);
  }, [scopesReady]);

  if (!released) return null;
  return <>{children}</>;
};

export default ProjectionHydrationGate;
