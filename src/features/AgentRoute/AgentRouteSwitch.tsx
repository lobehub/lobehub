'use client';

import { memo, type ReactElement, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';

import { resolveAgentRouteBranch, useAgentRouteResolution } from './useAgentRouteResolution';

interface AgentRouteSwitchProps {
  /** Shown while a slug is still being resolved, to avoid a not-found flash. */
  fallback?: ReactNode;
  /** The creator's own agent shell (layout + nested routes). */
  ownElement: ReactElement;
  /**
   * Where the creator lands when they open their OWN share link. Defaults to
   * the agent's share settings; a platform without that page (mobile) points
   * at the agent itself.
   */
  ownShareRedirect?: (agentId: string) => string;
  /** The agent-share visitor surface. */
  shareElement: ReactElement;
}

const defaultOwnShareRedirect = (agentId: string) => `/agent/${agentId}/share`;

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
const AgentRouteSwitch = memo<AgentRouteSwitchProps>(
  ({ fallback, ownElement, ownShareRedirect = defaultOwnShareRedirect, shareElement }) => {
    const { aid } = useParams<{ aid?: string }>();
    const { error, isLoading, kind, resolvedAgentId } = useAgentRouteResolution(aid);
    const branch = resolveAgentRouteBranch({ error, isLoading, kind });

    if (branch === 'loading') return <>{fallback ?? null}</>;

    // The creator is never a visitor of their own share: `/agent/<share-slug>`
    // is what they copied from the share settings, so send them back there.
    if (branch === 'ownShare' && resolvedAgentId)
      return <Navigate replace to={ownShareRedirect(resolvedAgentId)} />;

    return branch === 'share' ? shareElement : ownElement;
  },
);

AgentRouteSwitch.displayName = 'AgentRouteSwitch';

export default AgentRouteSwitch;
