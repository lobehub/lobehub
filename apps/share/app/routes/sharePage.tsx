import { BRANDING_NAME } from '@lobechat/business-const';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';
import { getIdFromIdentifier } from '@/utils/identifier';

import SharedPageView from '../../src/features/page/SharedPageView';
import { loadShareResources } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const documentId = getIdFromIdentifier(params.id ?? '', 'docs');
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;

  const sharedDocument = await createServerLambdaClient(request, apiBase)
    .pageShare.getSharedDocument.query({ documentId })
    .catch((error) => {
      console.error('[share] shared document SSR fetch failed:', error);
      return null;
    });

  return {
    description: shareMetaDescription(await loadShareResources(locale), 'pageDescription'),
    documentId,
    locale,
    sharedDocument,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const title = loaderData?.sharedDocument?.document?.title;

  return buildPageMeta({
    description: loaderData?.description ?? '',
    locale: loaderData?.locale,
    title: title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'article',
  });
};

export default function SharePageRoute() {
  const { documentId, sharedDocument } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: sharedDocument
          ? { [unstable_serialize(shareKeys.pageDocument(documentId))]: sharedDocument }
          : {},
      }}
    >
      <SharedPageView />
    </SWRConfig>
  );
}
