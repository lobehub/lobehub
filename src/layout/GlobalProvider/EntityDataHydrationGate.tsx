'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';

import { buildAccountEntityScope } from '@/libs/entityData';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useEntityStore } from '@/store/entity';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Hydrates the trusted identity scope before the first application surface
 * mounts. Later scope changes prepare their own partition without blanking the
 * running application; every EntityView selector remains explicitly scoped, so
 * data from the previous identity can never be selected during that window.
 */
const EntityDataHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const userId = useUserStore(userProfileSelectors.userId);
  const accountScope = userId ? buildAccountEntityScope(userId) : scope;
  const prepareEntityScope = useEntityStore((state) => state.prepareEntityScope);
  const scopesReady = useEntityStore(
    (state) =>
      state.scopes[scope]?.hydrationStatus === 'ready' &&
      state.scopes[accountScope]?.hydrationStatus === 'ready',
  );
  const [released, setReleased] = useState(scopesReady);

  useEffect(() => {
    void prepareEntityScope(scope);
    if (accountScope !== scope) void prepareEntityScope(accountScope);
  }, [accountScope, prepareEntityScope, scope]);

  useEffect(() => {
    if (scopesReady) setReleased(true);
  }, [scopesReady]);

  if (!released) return null;
  return <>{children}</>;
};

export default EntityDataHydrationGate;
