import { type MouseEvent, useCallback, useRef } from 'react';

import { channelPath } from '@/features/Channels/paths';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';

/** A plain left click; modified clicks keep the browser's own handling of the link. */
const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * With Channels on, an agent row opens the person's direct Channel with the Agent. An Agent made
 * before direct Channels has none yet, so the first click opens it; an Agent that cannot answer
 * in a Channel (no reachable device) or a failed open falls back to the Agent's own page.
 */
export const useAgentConversationLink = (agentId: string, agentUrl: string) => {
  const enabled = useChannelsEnabled();
  const directChannelId = useChannelStore((s) =>
    enabled ? channelSelectors.directByAgent(agentId)(s)?.id : undefined,
  );
  const navigate = useWorkspaceAwareNavigate();
  const opening = useRef(false);

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      if (opening.current) return;
      opening.current = true;
      void channelActions
        .openDirect(agentId)
        .then((channelId) => navigate(channelId ? channelPath(channelId) : agentUrl))
        .catch((error) => {
          console.error('[channel] Failed to open the direct Channel', error);
          navigate(agentUrl);
        })
        .finally(() => {
          opening.current = false;
        });
    },
    [agentId, agentUrl, navigate],
  );

  if (directChannelId) return { url: channelPath(directChannelId) };
  return { onClick: enabled ? onClick : undefined, url: agentUrl };
};
