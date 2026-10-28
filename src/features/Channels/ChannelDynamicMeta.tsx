import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import { matchesRouteWorkspace, useRouteWorkspaceId } from '@/features/RouteMeta/workspaceScope';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { channelSelectors, useChannelStore } from '@/store/channel';

/** Names the tab after the open Channel, from data the sidebar and page already loaded. */
const ChannelDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const routeWorkspaceId = useRouteWorkspaceId(params);
  const channelId = params.channelId ?? '';
  const title = useChannelStore((state) => {
    const channel =
      channelSelectors.list(state)?.find((item) => item.id === channelId) ??
      channelSelectors.detail({ channelId, threadId: null })(state)?.channel;
    return channel && matchesRouteWorkspace(channel.workspaceId, routeWorkspaceId)
      ? channel.title
      : undefined;
  });
  usePublishDynamicRouteMeta({ title }, onResolve);
  return null;
};

export default ChannelDynamicMeta;
