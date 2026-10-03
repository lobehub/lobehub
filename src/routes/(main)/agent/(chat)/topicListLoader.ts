import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { LoaderFunctionArgs } from 'react-router';

import { getSidebarTopicListParams } from '@/hooks/chatTopicListQuery';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Upper bound for the pre-paint hydrate.
 *
 * The read itself is not the risk: measured on the real storage path, a warm
 * IndexedDB read of the sidebar page (20 rows ≈ 9 KB) is ~0.2–0.5 ms p50, the
 * first read of a cold page with an existing database ~1–10 ms, and creating
 * the database ~7–30 ms. The deadline only ever fires on a pathological storage
 * stall, so a route transition never waits longer than this for it.
 */
export const PRE_PAINT_HYDRATE_TIMEOUT = 50;

/** Resolve once `promise` settles or `ms` elapses — never rejects, never hangs. */
const settleWithin = (promise: Promise<unknown>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    void Promise.resolve(promise).then(finish, finish);
  });

/**
 * Builtin slugs (`inbox`, …) resolve from the store; an id passes through. A
 * user-chosen slug needs a server lookup, so it resolves only after the route
 * redirects to the real id and the loader runs again — hydrating under the slug
 * key is a harmless miss.
 */
const resolveRouteAgentId = (routeAgentId?: string): string | undefined => {
  if (!routeAgentId) return undefined;
  if (!builtinAgentSlugs.has(routeAgentId)) return routeAgentId;

  return builtinAgentSelectors.getBuiltinAgentId(routeAgentId)(useAgentStore.getState());
};

/**
 * Seed the sidebar's persisted topic page for a route's agent.
 *
 * Route loaders run before React commits the new route, so this is the one place
 * a local (async) read can still land pre-paint. Without it the sidebar mounts
 * first and paints its loading skeleton until the in-tree hydrate resolves.
 */
export const preHydrateTopicListForRoute = async (routeAgentId?: string): Promise<void> => {
  const agentId = resolveRouteAgentId(routeAgentId);
  if (!agentId) return;

  const params = getSidebarTopicListParams({ agentId });
  if (!params) return;

  await settleWithin(
    useChatStore.getState().preHydrateTopicList(params),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );
};

/** Loader for the agent chat routes (`/agent/:aid`, `/agent/:aid/:topicId`). */
export const agentChatTopicListLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  await preHydrateTopicListForRoute(params.aid);

  return null;
};
