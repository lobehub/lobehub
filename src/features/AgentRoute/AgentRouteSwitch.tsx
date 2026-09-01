'use client';

import { memo, type ReactElement, type ReactNode } from 'react';
import { useParams } from 'react-router';

import { resolveAgentRouteBranch, useAgentRouteResolution } from './useAgentRouteResolution';

interface AgentRouteSwitchProps {
  /** Shown while a slug is still being resolved, to avoid a not-found flash. */
  fallback?: ReactNode;
  /** The creator's own agent shell (layout + nested routes). */
  ownElement: ReactElement;
  /** The agent-share visitor surface. */
  shareElement: ReactElement;
}

/**
 * `/agent/:slugOrId` serves two surfaces: the creator's own agent (by id or by
 * agent slug) and the agent-share visitor page (by share slug or share id).
 * React Router cannot tell them apart from the pattern alone, so the branch is
 * decided here, after the param is resolved server-side.
 *
 * A not-found param renders the own-agent shell, which already owns the agent
 * not-found card — the visitor page has no better story for an unknown link.
 * The share branch does not render an `Outlet`, so the nested creator routes
 * (`/agent/:aid/docs` …) stay unmounted for a visitor.
 */
const AgentRouteSwitch = memo<AgentRouteSwitchProps>(({ fallback, ownElement, shareElement }) => {
  const { aid } = useParams<{ aid?: string }>();
  const { isLoading, kind } = useAgentRouteResolution(aid);
  const branch = resolveAgentRouteBranch({ isLoading, kind });

  if (branch === 'loading') return <>{fallback ?? null}</>;

  return branch === 'share' ? shareElement : ownElement;
});

AgentRouteSwitch.displayName = 'AgentRouteSwitch';

export default AgentRouteSwitch;
