'use client';

import { memo, type ReactElement, type ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';

import { buildAgentShareVisitorPath } from '@/features/AgentShareVisitor/visitorPath';

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
}

const defaultOwnShareRedirect = (agentId: string) => `/agent/${agentId}/share`;

/**
 * `/agent/:slugOrId` is the creator's own agent, by id or by agent slug — but
 * share slugs used to live on this route too, and links handed out then are
 * permanent. React Router cannot tell an agent slug from a share slug by the
 * pattern alone, so the param is resolved server-side and a share slug is
 * forwarded to the visitor page at `/a/:slugOrId`.
 *
 * A not-found param renders the own-agent shell, which already owns the agent
 * not-found card. An UNAUTHORIZED lookup also forwards to the visitor page
 * (see `resolveAgentRouteBranch`): the sign-in prompt lives there.
 */
const AgentRouteSwitch = memo<AgentRouteSwitchProps>(
  ({ fallback, ownElement, ownShareRedirect = defaultOwnShareRedirect }) => {
    const { aid } = useParams<{ aid?: string }>();
    const { hash, search } = useLocation();
    const { error, isLoading, kind, resolvedAgentId } = useAgentRouteResolution(aid);
    const branch = resolveAgentRouteBranch({ error, isLoading, kind });

    if (branch === 'loading') return <>{fallback ?? null}</>;

    // The creator is never a visitor of their own share: `/agent/<share-slug>`
    // is what they copied from the share settings, so send them back there.
    if (branch === 'ownShare' && resolvedAgentId)
      return <Navigate replace to={ownShareRedirect(resolvedAgentId)} />;

    if (branch === 'share' && aid)
      return <Navigate replace to={`${buildAgentShareVisitorPath(aid)}${search}${hash}`} />;

    return ownElement;
  },
);

AgentRouteSwitch.displayName = 'AgentRouteSwitch';

export default AgentRouteSwitch;
