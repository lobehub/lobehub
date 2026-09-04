'use client';

import { memo } from 'react';
import { Navigate } from 'react-router';

import { useParams } from '@/libs/router/navigation';
import { routerSelectors, useRouterStore } from '@/store/router';

/**
 * The agent-share visitor surface moved from `/share/agent/:slugOrId` to
 * `/agent/:slugOrId`. Links handed out before the move are permanent, so the
 * old pattern stays registered and forwards in-app navigations; the edge
 * middleware issues the equivalent 301 for cold loads.
 */
const AgentShareLegacyRedirect = memo(() => {
  const { slugOrId } = useParams<{ slugOrId: string }>('slugOrId');
  const hash = useRouterStore(routerSelectors.hash);
  const search = useRouterStore(routerSelectors.search);

  return <Navigate replace to={`/agent/${slugOrId ?? ''}${search}${hash}`} />;
});

AgentShareLegacyRedirect.displayName = 'AgentShareLegacyRedirect';

export default AgentShareLegacyRedirect;
