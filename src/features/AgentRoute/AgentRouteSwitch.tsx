'use client';

import { memo, type ReactElement, type ReactNode } from 'react';
import { useParams } from 'react-router';

import { resolveAgentRouteBranch, useAgentRouteResolution } from './useAgentRouteResolution';

interface AgentRouteSwitchProps {
  /** Shown while a slug is still being resolved, to avoid a not-found flash. */
  fallback?: ReactNode;
  /** The creator's own agent shell (layout + nested routes). */
  ownElement: ReactElement;
}

/**
 * `/agent/:slugOrId` is the creator's own agent, by id or by agent slug. An id
 * is decided locally, while a user-chosen slug is resolved server-side, so the
 * switch holds `fallback` until the answer is in and only then renders the
 * shell.
 *
 * A not-found param renders the own-agent shell too, which already owns the
 * agent not-found card.
 */
const AgentRouteSwitch = memo<AgentRouteSwitchProps>(({ fallback, ownElement }) => {
  const { aid } = useParams<{ aid?: string }>();
  const { isLoading, kind } = useAgentRouteResolution(aid);
  const branch = resolveAgentRouteBranch({ isLoading, kind });

  if (branch === 'loading') return <>{fallback ?? null}</>;

  return ownElement;
});

AgentRouteSwitch.displayName = 'AgentRouteSwitch';

export default AgentRouteSwitch;
