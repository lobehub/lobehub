import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import useSWR from 'swr';

import type { AgentRouteResolution } from '@/server/routers/lambda/agent';
import { agentService } from '@/services/agent';
import { isTrpcErrorCode } from '@/utils/trpcError';

type AgentRouteResolutionKind = AgentRouteResolution['kind'];

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Every generated agent id carries an underscore (`agt_…`, `agent_…`) and no
 * generated slug does (`randomSlug` joins words with hyphens, and rename rejects
 * underscores). So the absence of one is what tells a slug route from an id
 * route — and a wrong guess only costs a lookup that resolves to nothing.
 */
export const looksLikeSlug = (routeAgentId?: string) =>
  !!routeAgentId && !routeAgentId.includes('_');

/** Builtin agents are addressed by a fixed slug that the store already knows. */
export const isBuiltinAgentSlug = (routeAgentId?: string) =>
  !!routeAgentId && builtinAgentSlugs.has(routeAgentId);

/**
 * A param only needs a server round trip when its shape leaves the answer open:
 * ids and builtin slugs are decided locally.
 */
export const needsAgentRouteLookup = (routeAgentId?: string) =>
  !isBuiltinAgentSlug(routeAgentId) && looksLikeSlug(routeAgentId);

export type AgentRouteBranch = 'loading' | 'own' | 'ownShare' | 'share';

/**
 * Which surface `/agent/:slugOrId` renders for a given resolution state.
 *
 * A not-found param falls back to the creator surface, which already owns the
 * agent not-found card — the visitor page has no better story for a dead link.
 *
 * An UNAUTHORIZED lookup is different: `resolveAgentRoute` is auth-gated, so
 * an anonymous visitor on a share URL fails the lookup itself, before `kind`
 * is ever known. Falling back to 'own' would show the creator's not-found
 * shell instead of a sign-in prompt, so this routes straight to 'share' and
 * lets `AgentShareVisitor`'s own `getSharedAgent` call (and its `signIn`
 * branch in `resolveShareAccessState`) render the CTA. Any other error keeps
 * the existing not-found fallback.
 */
export const resolveAgentRouteBranch = ({
  error,
  isLoading,
  kind,
}: {
  error?: unknown;
  isLoading: boolean;
  kind?: AgentRouteResolutionKind;
}): AgentRouteBranch => {
  if (isLoading) return 'loading';

  if (isTrpcErrorCode(error, 'UNAUTHORIZED')) return 'share';

  if (kind === 'share' || kind === 'ownShare') return kind;

  return 'own';
};

/**
 * Resolve a `/agent/:slugOrId` param, which serves two surfaces: the creator's
 * own agent and the agent-share visitor page.
 *
 * Id-shaped params and builtin slugs are decided locally, so an ordinary
 * `/agent/<id>` route never pays for a request. Only a user-chosen slug asks
 * the server, and that answer is shared with `useResolvedAgentRouteId` through
 * the same SWR key, so the switch and the layout resolve it exactly once.
 */
export const useAgentRouteResolution = (routeAgentId?: string) => {
  const needsLookup = needsAgentRouteLookup(routeAgentId);

  const { data, error, isLoading } = useSWR(
    needsLookup ? ['agent-route', routeAgentId] : null,
    () => agentService.resolveAgentRoute(routeAgentId!),
    { revalidateOnFocus: false },
  );

  return {
    /** The lookup's failure, if any — see `resolveAgentRouteBranch` for how UNAUTHORIZED is handled. */
    error: needsLookup ? error : undefined,
    /** True only while a slug lookup is in flight, i.e. the kind is unknown yet. */
    isLoading: needsLookup && isLoading,
    kind: needsLookup ? data?.kind : ('own' as const),
    /** The id behind a user-chosen agent slug (or the caller's own share slug), once known. */
    resolvedAgentId: data?.kind === 'own' || data?.kind === 'ownShare' ? data.agentId : undefined,
  };
};
