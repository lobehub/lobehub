import { APPLE_APP_STORE_ID, BRANDING_NAME } from '@lobechat/business-const';
import type { ClientLoaderFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';

import {
  readSharedTopicFirstPage,
  sharedTopicMessagesScript,
} from '../../src/features/topic/sharedConversation';
import SharedTopicView, { preloadSharedTopic } from '../../src/features/topic/SharedTopicView';
import { buildTopicByline } from '../../src/features/topic/topicByline';
import { loadShareT } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription, truncateDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const shareId = params.id!;
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;
  const client = createServerLambdaClient(request, apiBase);

  // SSR data is best-effort: on any backend failure fall back to CSR, where SWR
  // refetches and surfaces the error state exactly as before. The first rounds
  // are read with the share id alone, so both reads run side by side.
  const [topic, { firstPage, messageReadMode }] = await Promise.all([
    client.share.getSharedTopic.query({ shareId }).catch((error) => {
      console.error('[share] shared topic SSR fetch failed:', error);
      return null;
    }),
    readSharedTopicFirstPage(client, shareId),
  ]);

  return {
    appArgument: `${new URL(request.url).origin}/share/t/${encodeURIComponent(shareId)}`,
    firstPage,
    messageReadMode,
    byline: topic ? buildTopicByline(topic) : undefined,
    description: shareMetaDescription(await loadShareT(locale), 'topicDescription'),
    locale,
    shareId,
    topic,
  };
};

// Runs as the hydrated router initializes. On that first call `serverLoader()`
// hands back the data already in the document, so this costs no request; it
// hands the conversation the messages the document carries.
export const clientLoader = async ({ serverLoader }: ClientLoaderFunctionArgs) => {
  const data = await serverLoader<typeof loader>();
  if (data.topic) preloadSharedTopic(data.topic, data);

  return data;
};

// No `HydrateFallback`: the route keeps hydrating with its server data.
clientLoader.hydrate = true as const;

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.topic?.title;

  const metas = buildPageMeta({
    description: [truncateDescription(loaderData?.byline), loaderData?.description]
      .filter(Boolean)
      .join(' · '),
    locale: loaderData?.locale,
    title: title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'article',
  });
  if (APPLE_APP_STORE_ID && loaderData?.appArgument)
    metas.push({
      name: 'apple-itunes-app',
      content: `app-id=${APPLE_APP_STORE_ID}, app-argument=${loaderData.appArgument}`,
    });
  return metas;
};

export default function ShareTopicRoute() {
  const { messageReadMode, shareId, topic } = useLoaderData<typeof loader>();
  // The document starts the newest-first read only when the server cannot page
  // forward; reading forward, the first rounds are already in the loader data.
  const messagesScript =
    topic && messageReadMode === 'backward' ? sharedTopicMessagesScript(topic) : '';

  return (
    <SWRConfig
      value={{
        fallback: topic ? { [unstable_serialize(shareKeys.topic(shareId))]: topic } : {},
      }}
    >
      {messagesScript && <script dangerouslySetInnerHTML={{ __html: messagesScript }} />}
      <SharedTopicView messageReadMode={messageReadMode} />
    </SWRConfig>
  );
}
