'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';

import { useCacheScope } from '@/libs/swr/useCacheScope';
import { buildAccountProjectionScope, useProjectionStore } from '@/projection';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Hydrates the trusted identity scope before the first application surface
 * mounts. Later scope changes prepare their own partition without blanking the
 * running application; every Projection selector remains explicitly scoped, so
 * data from the previous identity can never be selected during that window.
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
    void prepareProjectionScope(scope);
    if (accountScope !== scope) void prepareProjectionScope(accountScope);
  }, [accountScope, prepareProjectionScope, scope]);

  useEffect(() => {
    if (scopesReady) setReleased(true);
  }, [scopesReady]);

  if (!released) return null;
  return <>{children}</>;
};

export default ProjectionHydrationGate;
