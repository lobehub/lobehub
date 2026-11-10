import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

/** Names the tab after the open provider, from the list and detail the provider page loads. */
const ProviderDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const providerId = params.providerId ?? '';
  const name = useAiInfraStore(
    (s) =>
      aiProviderSelectors.providerDetailById(providerId)(s)?.name ||
      s.aiProviderList.find((item) => item.id === providerId)?.name,
  );

  usePublishDynamicRouteMeta({ title: name || undefined }, onResolve);

  return null;
};

export default ProviderDynamicMeta;
