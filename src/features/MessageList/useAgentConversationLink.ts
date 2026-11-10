import { CHANNEL_URL } from '@lobechat/const';
import { type MouseEvent, useCallback, useEffect, useRef } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { usePreservedAgentUrl } from '@/features/HomeSidebar/Body/Agent/List/usePreservedAgentUrl';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';

import { isPlainClick } from './conversations';

/**
 * With Channels on, an agent row opens the person's direct Channel with the Agent. An Agent made
 * before direct Channels has none yet, so the first click opens it; an Agent that cannot answer
 * in a Channel (no reachable device) or a failed open falls back to the Agent's own page. Without
 * an id yet (the inbox Agent while it loads) the row stays on the Agent's page.
 */
export const useAgentConversationLink = (agentId: string | undefined, agentUrl: string) => {
  const enabled = useChannelsEnabled() && !!agentId;
  const directChannelId = useChannelStore((s) =>
    enabled ? channelSelectors.directByAgent(agentId!)(s)?.id : undefined,
  );
  const navigate = useWorkspaceAwareNavigate();
  const opening = useRef(false);
  const { pathname, search } = useActiveLocation();
  const slug = useActiveWorkspaceSlug();
  // Where the person is now. Opening a missing Channel takes a request, and by the time it
  // answers they may have picked another conversation or workspace.
  const location = `${slug ?? ''}|${pathname}${search}`;
  const here = useRef(location);
  useEffect(() => {
    here.current = location;
  }, [location]);

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!agentId || !isPlainClick(event)) return;
      event.preventDefault();
      if (opening.current) return;
      opening.current = true;
      const from = here.current;
      const scope = cacheScope.get();
      // Navigate only if nothing else was selected meanwhile, and never route an id from the
      // previous workspace under a new one.
      const go = (path: string) => {
        if (here.current === from && cacheScope.get() === scope) navigate(path);
      };
      void channelActions
        .openDirect(agentId)
        .then((channelId) => go(channelId ? CHANNEL_URL(channelId) : agentUrl))
        .catch((error) => {
          console.error('[channel] Failed to open the direct Channel', error);
          go(agentUrl);
        })
        .finally(() => {
          opening.current = false;
        });
    },
    [agentId, agentUrl, navigate],
  );

  if (directChannelId) return { url: CHANNEL_URL(directChannelId) };
  return { onClick: enabled ? onClick : undefined, url: agentUrl };
};

/** The inbox Agent's row opens its direct Channel the same way any other Agent's row does. */
export const useInboxConversationLink = () => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const agentUrl = usePreservedAgentUrl(resolveInboxAgentRouteId(inboxAgentId));
  return useAgentConversationLink(inboxAgentId, agentUrl);
};
