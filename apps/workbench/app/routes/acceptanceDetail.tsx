import { BRANDING_NAME } from '@lobechat/business-const';
import { lazy, Suspense, useRef } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData, useRouteLoaderData } from 'react-router';

import { useVerifyStore } from '@/store/verify';

import WorkbenchLoading from '../../src/shell/WorkbenchLoading';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, truncateDescription, workbenchMetaDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';
import type { loader as rootLoader } from '../root';

// The embed never loads the normal host's review and sharing capabilities.
const AcceptanceDetail = lazy(() => import('../../src/features/acceptance/AcceptanceDetail'));
const AcceptanceEmbed = lazy(() => import('../../src/features/acceptance/AcceptanceEmbed'));

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
  const root = useRouteLoaderData<typeof rootLoader>('root');
  const { acceptanceId, bundle } = useLoaderData<typeof loader>();

  // The loader already fetched an authorized bundle. The Workbench runtime never
  // hydrates the persisted replica, so seed the store from the loader result
  // before the gate below reads it — otherwise the first render has no data and
  // shows a spinner until client revalidation lands. Seeded once per acceptance
  // id (the route component is reused across param changes); later renders keep
  // whatever the live replica holds.
  const seededId = useRef<string | null>(null);
  if (bundle && seededId.current !== acceptanceId) {
    seededId.current = acceptanceId;
    useVerifyStore.getState().seedAcceptanceBundle(acceptanceId, bundle);
  }

  return (
    <Suspense fallback={<WorkbenchLoading />}>
      {root?.embedConfig.embed ? <AcceptanceEmbed /> : <AcceptanceDetail />}
    </Suspense>
  );
}
