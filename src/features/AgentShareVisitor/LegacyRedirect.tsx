'use client';

import { memo } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';

import { buildAgentShareVisitorPath } from './visitorPath';

/**
 * The agent-share visitor surface started at `/share/agent/:slugOrId` and now
 * lives at `/a/:slugOrId`. Links handed out under the first pattern are
 * permanent, so it stays registered and forwards in-app navigations; the edge
 * middleware issues the equivalent 301 for cold loads. (The intermediate
 * `/agent/<share-slug>` form is forwarded by `AgentRouteSwitch` instead, since
 * that route still serves the creator's own agents.)
 */
const AgentShareLegacyRedirect = memo(() => {
  const { slugOrId } = useParams<{ slugOrId: string }>();
  const { hash, search } = useLocation();

  return <Navigate replace to={`${buildAgentShareVisitorPath(slugOrId ?? '')}${search}${hash}`} />;
});

AgentShareLegacyRedirect.displayName = 'AgentShareLegacyRedirect';

export default AgentShareLegacyRedirect;
