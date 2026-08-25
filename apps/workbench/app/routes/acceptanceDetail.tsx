import { BRANDING_NAME } from '@lobechat/business-const';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { verifyKeys } from '@/libs/swr/keys';

import AcceptanceDetail from '../../src/features/acceptance/AcceptanceDetail';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, truncateDescription, workbenchMetaDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const acceptanceId = params.acceptanceId!;
  const apiBase = context.get(cloudflareContext).env.WORKBENCH_API_BASE as string | undefined;

  // SSR data is best-effort: on any backend failure fall back to CSR, where
  // SWR refetches and surfaces the error state exactly as before.
  const bundle = await createServerLambdaClient(request, apiBase)
    .acceptance.getBundle.query({ id: acceptanceId })
    .catch((error) => {
      console.error('[workbench] acceptance bundle SSR fetch failed:', error);
      return null;
    });

  return { acceptanceId, bundle };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const subjectTitle = loaderData?.bundle?.subject?.title;

  return buildPageMeta({
    description:
      truncateDescription(loaderData?.bundle?.acceptance?.requirement) ??
      workbenchMetaDescription(undefined),
    title: subjectTitle ? `${subjectTitle} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'article',
  });
};

export default function AcceptanceDetailRoute() {
  const { acceptanceId, bundle } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: bundle
          ? { [unstable_serialize(verifyKeys.acceptanceBundle(acceptanceId))]: bundle }
          : {},
      }}
    >
      <AcceptanceDetail />
    </SWRConfig>
  );
}
