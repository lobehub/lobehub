import { useLayoutEffect } from 'react';

import { useTopicDrawerPortalHostViewType } from '@/features/AgentTasks/hooks/useTopicDrawerArtifactPortal';
import type { InternalLinkReference } from '@/features/EntityLink';
import { isAcceptancePortalView } from '@/features/Home/acceptancePortalView';
import { useChatStore } from '@/store/chat';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';

/**
 * Portal views a Channel shows beside its feed: a linked report, an Agent's
 * profile, a linked task, or a page in the side browser.
 */
export const isChannelPortalView = (viewType: PortalViewType | null) =>
  isAcceptancePortalView(viewType) ||
  viewType === PortalViewType.AgentDetail ||
  viewType === PortalViewType.TaskDetail ||
  viewType === PortalViewType.Browser;

/**
 * Entity details a Channel can show beside its feed, kept next to the views it
 * has to match; anything else follows its own route.
 */
export const CHANNEL_ENTITY_PORTAL_SCOPE = [
  'acceptance',
  'agent',
  'task',
] as const satisfies readonly InternalLinkReference['type'][];

/** Each Channel browses in its own retained page, apart from every agent topic's. */
export const channelBrowserSessionId = (channelId: string) => `channel:${channelId}`;

/**
 * The view the panel is hosting. A task's run drawer pushes the artifact it generates
 * on top of the task, so the top of the stack is that artifact while the task is still
 * what the Channel opened — resolve it back to the host, the way the agent portal does.
 */
export const useChannelPortalViewType = () => useTopicDrawerPortalHostViewType();

export const usePortalPanelOpen = () => isChannelPortalView(useChannelPortalViewType());

/** Whether a portal view is open beside this Channel, and how to close it. */
export const usePortalPanel = (channelId: string) => {
  const open = usePortalPanelOpen();
  const close = useChatStore((s) => s.clearPortalStack);
  // The portal stack is global: a view left open on another page, or by the previous
  // Channel, must not appear here.
  useLayoutEffect(() => {
    close();
    return close;
  }, [channelId, close]);
  return { close, open };
};
