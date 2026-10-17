import { BRANDING_NAME } from '@lobechat/business-const';
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';

import SharedTopicView, { preloadSharedTopic } from '../../src/features/topic/SharedTopicView';
import { buildTopicByline } from '../../src/features/topic/topicByline';
import { loadShareResources } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription, truncateDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const shareId = params.id!;
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;
  const client = createServerLambdaClient(request, apiBase);

  // SSR data is best-effort: on any backend failure fall back to CSR, where SWR
  // refetches and surfaces the error state exactly as before.
  const topic = await client.share.getSharedTopic.query({ shareId }).catch((error) => {
    console.error('[share] shared topic SSR fetch failed:', error);
    return null;
  });

  return {
    byline: topic ? buildTopicByline(topic) : undefined,
    description: shareMetaDescription(await loadShareResources(locale), 'topicDescription'),
    locale,
    shareId,
    topic,
  };
};

// Runs as the router initializes on the client, before the hydration render.
// On that first call `serverLoader()` hands back the data already in the
// document, so this costs no request; it only starts the conversation's chunks
// and messages as early as the client can know which conversation it is.
export const clientLoader = async ({ serverLoader }: ClientLoaderFunctionArgs) => {
  const data = await serverLoader<typeof loader>();
  if (data.topic) preloadSharedTopic(data.topic);

  return data;
};

// No `HydrateFallback`: the route keeps hydrating with its server data.
clientLoader.hydrate = true as const;

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.topic?.title;

  return buildPageMeta({
    description: [truncateDescription(loaderData?.byline), loaderData?.description]
      .filter(Boolean)
      .join(' · '),
    locale: loaderData?.locale,
    title: title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'article',
  });
};

export default function ShareTopicRoute() {
  const { shareId, topic } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: topic ? { [unstable_serialize(shareKeys.topic(shareId))]: topic } : {},
      }}
    >
      <SharedTopicView />
    </SWRConfig>
  );
}
