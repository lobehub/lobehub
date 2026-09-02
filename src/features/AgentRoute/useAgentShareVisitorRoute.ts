'use client';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { resolveAgentRouteBranch, useAgentRouteResolution } from './useAgentRouteResolution';

/**
 * The `aid` of `/agent/:aid` — and of its workspace mirror
 * `/:workspaceSlug/agent/:aid` — read straight from the pathname, because the
 * main layout sits above that route and therefore has no `useParams` access to
 * it.
 *
 * Only the exact two-segment route counts: the nested creator routes
 * (`/agent/:aid/docs` …) never render the visitor surface. The workspace prefix
 * is stripped only when it equals the active slug, so sibling routes such as
 * `/community/agent/:slug` are not mistaken for an agent route — the same rule
 * `resolveNavPanelKey` uses.
 */
export const resolveAgentRouteParam = (
  pathname: string,
  activeWorkspaceSlug: string | null,
): string | undefined => {
  const segments = pathname.split('/').filter(Boolean);
  const routeSegments =
    !!activeWorkspaceSlug && segments[0] === activeWorkspaceSlug ? segments.slice(1) : segments;

  if (routeSegments.length !== 2 || routeSegments[0] !== 'agent') return undefined;

  return routeSegments[1];
};

/**
 * Whether the current route renders the agent-share visitor surface, i.e. the
 * `share` branch of `AgentRouteSwitch`.
 *
 * A visitor is not signed into the creator's workspace, so the main nav has no
 * data to show and would sit on a grey skeleton forever — the layout unmounts
 * it entirely for this branch. The branch is derived from the very same SWR key
 * as the switch itself, so this costs no extra request.
 *
 * While a slug lookup is still in flight the answer is `false`: nearly all
 * `/agent/:aid` traffic is the creator's own agent, and keeping the nav mounted
 * until proven otherwise avoids a flash on the common path.
 */
export const useIsAgentShareVisitorRoute = (): boolean => {
  const { pathname } = useActiveLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { error, isLoading, kind } = useAgentRouteResolution(
    resolveAgentRouteParam(pathname, activeWorkspaceSlug),
  );

  return resolveAgentRouteBranch({ error, isLoading, kind }) === 'share';
};
