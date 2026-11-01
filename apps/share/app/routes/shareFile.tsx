import { BRANDING_NAME } from '@lobechat/business-const';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';

import SharedFileView from '../../src/features/file/SharedFileView';
import { loadShareT } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const shareId = params.id!;
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;

  const sharedFile = await createServerLambdaClient(request, apiBase)
    .fileShare.getSharedFile.query({ shareId })
    .catch((error) => {
      console.error('[share] shared file SSR fetch failed:', error);
      return null;
    });

  return {
    description: shareMetaDescription(await loadShareT(locale), 'fileDescription'),
    locale,
    shareId,
    sharedFile,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const name = loaderData?.sharedFile?.file.name;

  return buildPageMeta({
    description: loaderData?.description ?? '',
    locale: loaderData?.locale,
    title: name ? `${name} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'website',
  });
};

export default function ShareFileRoute() {
  const { shareId, sharedFile } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: sharedFile ? { [unstable_serialize(shareKeys.file(shareId))]: sharedFile } : {},
      }}
    >
      <SharedFileView />
    </SWRConfig>
  );
}
