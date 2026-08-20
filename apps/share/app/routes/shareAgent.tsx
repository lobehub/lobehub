import { BRANDING_NAME } from '@lobechat/business-const';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { sharedAgentDisplayName } from '@/features/AgentShareVisitor/displayName';
import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';

import SharedAgentView from '../../src/features/agent/SharedAgentView';
import { loadShareResources } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription, truncateDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const shareId = params.id!;
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;
  const agent = await createServerLambdaClient(request, apiBase)
    .share.getSharedAgent.query({ shareId, trackView: false })
    .catch((error) => {
      console.error('[share] shared agent SSR fetch failed:', error);
      return null;
    });

  return {
    agent,
    description: shareMetaDescription(await loadShareResources(locale), 'agentDescription'),
    locale,
    shareId,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = sharedAgentDisplayName(loaderData?.agent?.agentMeta);

  return buildPageMeta({
    description:
      truncateDescription(loaderData?.agent?.agentMeta.description) ??
      loaderData?.description ??
      '',
    locale: loaderData?.locale,
    title: title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME,
  });
};

export default function ShareAgentRoute() {
  const { agent, shareId } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: agent ? { [unstable_serialize(shareKeys.agentInfo(shareId))]: agent } : {},
      }}
    >
      <SharedAgentView />
    </SWRConfig>
  );
}
