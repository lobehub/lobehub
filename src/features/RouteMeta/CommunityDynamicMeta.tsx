import { usePublishDynamicRouteMeta } from '@/features/RouteMeta/usePublishDynamicRouteMeta';
import type { DynamicRouteMetaProps } from '@/spa/router/routeMeta';
import { useDiscoverStore } from '@/store/discover';
import {
  assistantSelectors,
  groupAgentSelectors,
  mcpSelectors,
  modelSelectors,
  providerSelectors,
  skillSelectors,
  userSelectors,
} from '@/store/discover/selectors';
import type { AssistantMarketSource } from '@/types/discover';

/*
 * Each community detail page titles the tab after the item it shows. Every
 * component calls the page's own fetch hook with the page's own arguments, so
 * it reads the same replica entry and the request is shared with the page.
 */

const decodeSlug = (slug: string | undefined) => decodeURIComponent(slug ?? '');

export const AssistantDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useFetchDetail = useDiscoverStore((s) => s.useFetchAssistantDetail);
  const { queryKey } = useFetchDetail({
    identifier: decodeSlug(params.slug),
    source: params.source as AssistantMarketSource | undefined,
    version: params.version,
  });
  const title = useDiscoverStore((s) => assistantSelectors.assistantDetail(queryKey)(s)?.title);

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

/** The detail payload is the raw market response, not the declared item type. */
interface GroupAgentDetailResponse {
  currentVersion?: { name?: string };
  group?: { name?: string };
}

export const GroupAgentDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useFetchDetail = useDiscoverStore((s) => s.useFetchGroupAgentDetail);
  const { queryKey } = useFetchDetail({
    identifier: decodeSlug(params.slug),
    version: params.version,
  });
  const title = useDiscoverStore((s) => {
    const data = groupAgentSelectors.groupAgentDetail(queryKey)(s) as
      GroupAgentDetailResponse | undefined;
    return data?.currentVersion?.name || data?.group?.name;
  });

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export const ModelDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useFetchDetail = useDiscoverStore((s) => s.useFetchModelDetail);
  const { queryKey } = useFetchDetail({ identifier: decodeSlug(params.slug) });
  const title = useDiscoverStore((s) => modelSelectors.modelDetail(queryKey)(s)?.displayName);

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export const ProviderDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useFetchDetail = useDiscoverStore((s) => s.useFetchProviderDetail);
  const { queryKey } = useFetchDetail({ identifier: decodeSlug(params.slug), withReadme: true });
  const title = useDiscoverStore((s) => providerSelectors.providerDetail(queryKey)(s)?.name);

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export const SkillDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useFetchDetail = useDiscoverStore((s) => s.useFetchSkillDetail);
  const { queryKey } = useFetchDetail({ identifier: params.slug ?? '', version: params.version });
  const title = useDiscoverStore((s) => skillSelectors.skillDetail(queryKey)(s)?.name);

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

export const McpDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useFetchDetail = useDiscoverStore((s) => s.useFetchMcpDetail);
  const { queryKey } = useFetchDetail({ identifier: params.slug ?? '', version: params.version });
  const title = useDiscoverStore((s) => mcpSelectors.mcpDetail(queryKey)(s)?.name);

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};

/** A user or an organization profile: both are market accounts. */
export const UserDynamicMeta = ({ onResolve, params }: DynamicRouteMetaProps) => {
  const useUserProfile = useDiscoverStore((s) => s.useUserProfile);
  const { queryKey } = useUserProfile({ username: decodeSlug(params.slug) });
  const title = useDiscoverStore((s) => {
    const user = userSelectors.userProfile(queryKey)(s)?.user;
    return user ? user.displayName || user.userName || user.namespace : undefined;
  });

  usePublishDynamicRouteMeta({ title: title || undefined }, onResolve);

  return null;
};
