import { BRANDING_NAME } from '@lobechat/business-const';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';

import SharedArtifactView from '../../src/features/artifact/SharedArtifactView';
import { loadShareResources } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const id = params.id!;
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;

  const artifact = await createServerLambdaClient(request, apiBase)
    .artifactShare.getShared.query({ id })
    .catch((error) => {
      console.error('[share] shared artifact SSR fetch failed:', error);
      return null;
    });

  return {
    artifact,
    description: shareMetaDescription(await loadShareResources(locale), 'artifactDescription'),
    id,
    locale,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.artifact?.title;

  return buildPageMeta({
    description: loaderData?.description ?? '',
    locale: loaderData?.locale,
    title: title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'website',
  });
};

export default function ShareArtifactRoute() {
  const { artifact, id } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: artifact ? { [unstable_serialize(shareKeys.artifact(id))]: artifact } : {},
      }}
    >
      <SharedArtifactView />
    </SWRConfig>
  );
}
