import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';

import { SUPPORTED_MESSENGER_PLATFORMS } from '@/features/Messenger/platforms';
import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { messengerSelectors, useMessengerStore } from '@/store/messenger';

export default function AppDynamicMeta({ onResolve, params }: DynamicRouteMetaProps) {
  const id = params.appId ?? '';
  const channelName = useMessengerStore(
    (state) => messengerSelectors.platforms(state)?.find((channel) => channel.id === id)?.name,
  );
  const title =
    channelName ??
    SUPPORTED_MESSENGER_PLATFORMS.find((channel) => channel.id === id)?.name ??
    getLobehubSkillProviderById(id)?.label ??
    getComposioAppByIdentifier(id)?.label;
  usePublishDynamicRouteMeta({ title }, onResolve);
  return null;
}
