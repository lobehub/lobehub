'use client';

import type { PropsWithChildren } from 'react';
import { useEffect, useState } from 'react';

import { buildAccountClientDataScope, useClientDataStore } from '@/client-data';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Hydrates the trusted identity scope before the first application surface
 * mounts. Later scope changes prepare their own partition without blanking the
 * running application; every EntityView selector remains explicitly scoped, so
 * data from the previous identity can never be selected during that window.
 */
const ClientDataHydrationGate = ({ children }: PropsWithChildren) => {
  const scope = useCacheScope();
  const userId = useUserStore(userProfileSelectors.userId);
  const accountScope = userId ? buildAccountClientDataScope(userId) : scope;
  const prepareClientDataScope = useClientDataStore((state) => state.prepareClientDataScope);
  const scopesReady = useClientDataStore(
    (state) =>
      state.scopes[scope]?.hydrationStatus === 'ready' &&
      state.scopes[accountScope]?.hydrationStatus === 'ready',
  );
  const [released, setReleased] = useState(scopesReady);

  useEffect(() => {
    void prepareClientDataScope(scope);
    if (accountScope !== scope) void prepareClientDataScope(accountScope);
  }, [accountScope, prepareClientDataScope, scope]);

  useEffect(() => {
    if (scopesReady) setReleased(true);
  }, [scopesReady]);

  if (!released) return null;
  return <>{children}</>;
};

export default ClientDataHydrationGate;
