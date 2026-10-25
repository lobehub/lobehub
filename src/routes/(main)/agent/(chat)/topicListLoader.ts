import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { LoaderFunctionArgs } from 'react-router';

import { looksLikeSlug } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { getSidebarTopicListParams } from '@/hooks/chatTopicListQuery';
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useDeviceStore } from '@/store/device';
import { useUserStore } from '@/store/user';
import { useVerifyStore } from '@/store/verify';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * Builtin slugs (`inbox`, …) resolve from the store; an id passes through. A
 * user-chosen slug resolves from its persisted `slug → id` (seeded by the
 * loader); with none, hydrating under the slug key is a harmless miss and the
 * route resolves it once the lookup answers.
 */
const resolveRouteAgentId = (routeAgentId?: string): string | undefined => {
  if (!routeAgentId) return undefined;
  const state = useAgentStore.getState();
  if (builtinAgentSlugs.has(routeAgentId))
    return builtinAgentSelectors.getBuiltinAgentId(routeAgentId)(state);

  return agentSelectors.getAgentIdBySlug(routeAgentId)(state) ?? routeAgentId;
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

  // The workspace "only mine" filter is part of the list identity; read it
  // before deriving the params, or the seeded page is the unfiltered one.
  let preferenceKnown = false;
  await settleWithin(
    useUserStore
      .getState()
      .preHydrateWorkspaceUserPreference()
      .then((known) => {
        preferenceKnown = known;
      }),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );
  // Still unknown (no local copy yet, e.g. set on another device): any page
  // seeded now could be the unfiltered one, so leave the list to the mounted,
  // preference-gated fetch.
  if (!preferenceKnown) return;

  const params = getSidebarTopicListParams({ agentId });
  if (!params) return;

  await settleWithin(
    useChatStore.getState().preHydrateTopicList(params),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );
};

/**
 * Seed the persisted transcript of a route's topic into the chat store.
 *
 * The conversation renders the chat store's bucket, so rows landing there
 * before the route commits reach the Conversation as its first-frame messages:
 * a topic opened before paints from local data and only revalidates in the
 * background, instead of painting a skeleton until the network answers.
 */
export const preHydrateMessagesForRoute = async (
  routeAgentId?: string,
  topicId?: string,
): Promise<void> => {
  const agentId = resolveRouteAgentId(routeAgentId);
  if (!agentId || !topicId) return;

  const context = { agentId, scope: 'main' as const, topicId };
  const seed = async () => {
    await useChatStore.getState().preHydrateMessages(context);

    // Verify cards render from their own replica: seed the cards of the seeded
    // transcript before the route commits, so a settled card paints in the same
    // frame as its message instead of after its own mount-time storage read.
    const messages = useChatStore.getState().dbMessagesMap[messageMapKey(context)] ?? [];
    const verifyOperationIds = messages.flatMap((message) =>
      message.role === 'verify' && message.metadata?.verifyOperationId
        ? [message.metadata.verifyOperationId]
        : [],
    );
    await useVerifyStore.getState().preHydrateVerifyRuns(verifyOperationIds);
  };

  await settleWithin(seed(), PRE_PAINT_HYDRATE_TIMEOUT);
};

/**
 * Seed the persisted sub-thread list of a route's topic, so the topic's thread
 * rows and the thread portal header paint from local data on the first frame.
 */
export const preHydrateThreadsForRoute = async (topicId?: string): Promise<void> => {
  if (!topicId) return;

  await settleWithin(useChatStore.getState().preHydrateThreads(topicId), PRE_PAINT_HYDRATE_TIMEOUT);
};

/**
 * Seed the persisted device list, so the input bar names the bound device and
 * resolves its cwd on the first frame instead of after the mount-time hydrate.
 */
export const preHydrateDeviceListForRoute = (): Promise<void> =>
  settleWithin(useDeviceStore.getState().preHydrateDeviceList(), PRE_PAINT_HYDRATE_TIMEOUT);

/** Loader for the agent chat routes (`/agent/:aid`, `/agent/:aid/:topicId`). */
export const agentChatTopicListLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  /**
   * A builtin slug (`inbox`, …) resolves to its id from `builtinAgentIdMap`, so
   * the persisted builtin agent must be seeded before `resolveRouteAgentId` runs.
   * The replica's storage read is the only place it can land pre-paint — the
   * mount-time sync (and its hydrate) has not run yet.
   */
  if (params.aid && builtinAgentSlugs.has(params.aid)) {
    await settleWithin(
      useAgentStore.getState().preHydrateBuiltinAgent(params.aid),
      PRE_PAINT_HYDRATE_TIMEOUT,
    );
  } else if (looksLikeSlug(params.aid)) {
    // A user-chosen slug: seed its persisted `slug → id` the same way, so the
    // agent (and its topics / transcript below) paints before the lookup answers.
    await settleWithin(
      useAgentStore.getState().preHydrateAgentSlug(params.aid!),
      PRE_PAINT_HYDRATE_TIMEOUT,
    );
  }

  await Promise.all([
    preHydrateTopicListForRoute(params.aid),
    preHydrateMessagesForRoute(params.aid, params.topicId),
    preHydrateThreadsForRoute(params.topicId),
    preHydrateDeviceListForRoute(),
  ]);

  return null;
};
