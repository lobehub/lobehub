import { useTranslation } from 'react-i18next';

import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import type { DynamicRouteMetaProps, RouteMetaParams } from '@/spa/router/routeMeta';
import { useAgentStore } from '@/store/agent';
import { channelSelectors, useChannelStore } from '@/store/channel';

/**
 * Names the tab after the open Channel, from data the sidebar and page already loaded. A direct
 * conversation stands for its Agent, so its tab wears that Agent's avatar instead of `#`.
 */
const useRouteChannel = (params: RouteMetaParams) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const channelId = params.channelId ?? '';
  const detail = useChannelStore(channelSelectors.detail({ channelId, threadId: null }));
  const channel = useChannelStore(
    (state) =>
      channelSelectors.list(state)?.find((item) => item.id === channelId) ?? detail?.channel,
  );
  const visible = !!channel && matchesRouteWorkspace(channel.workspaceId, routeWorkspaceId);

  return { channel: visible ? channel : undefined, detail };
};

const ChannelDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { channel, detail } = useRouteChannel(params);
  const agentId = channel?.agentId ?? undefined;
  const agent = useAgentStore((state) => (agentId ? state.agentMap[agentId] : undefined));
  // The page loads members before the Agent itself, so the member row covers the first paint.
  const memberAvatar = agentId
    ? detail?.members.find((member) => member.agentId === agentId)?.avatar
    : undefined;

  usePublishDynamicRouteMeta(
    agentId
      ? {
          // A loaded Agent without an avatar publishes `null`, so the tab drops a cached one.
          avatar: agent ? agent.avatar || null : memberAvatar || undefined,
          avatarKind: 'agent',
          avatarSeed: agentId,
          backgroundColor: agent?.backgroundColor || undefined,
          title: channel?.title,
        }
      : { title: channel?.title },
    onResolve,
  );
  return null;
};

/** The settings page keeps its own label and names the Channel it configures. */
export const ChannelSettingsDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const { t } = useTranslation('channel');
  const { channel } = useRouteChannel(params);

  usePublishDynamicRouteMeta(
    { title: channel?.title ? `${t('settings.title')} · ${channel.title}` : undefined },
    onResolve,
  );
  return null;
};

export default ChannelDynamicMeta;
