import { BRANDING_NAME } from '@lobechat/business-const';
import { lazy, Suspense } from 'react';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData, useRouteLoaderData } from 'react-router';

import { extractUuid } from '@/features/Acceptance/utils';
import { AcceptanceInitialBundle } from '@/features/Acceptance/Viewer/AcceptanceInitialBundle';

import WorkbenchLoading from '../../src/shell/WorkbenchLoading';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, truncateDescription, workbenchMetaDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';
import type { loader as rootLoader } from '../root';

// The embed never loads the normal host's review and sharing capabilities.
const AcceptanceDetail = lazy(() => import('../../src/features/acceptance/AcceptanceDetail'));
const AcceptanceEmbed = lazy(() => import('../../src/features/acceptance/AcceptanceEmbed'));

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  // Normalize the same way the rendered viewer does, so the id the loader
  // fetches for is the id the render tree reads its bundle under.
  const acceptanceId = extractUuid(params.acceptanceId)!;
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
  // hydrates the persisted replica, so hand the bundle to the tree as
  // request-local context data — the gate paints it on the first frame instead
  // of a spinner. It must NOT go into the replica store: that store is a module
  // singleton shared by every request the server handles, so a render-time write
  // would leak one request's authorized entry into a later (or concurrent)
  // request whose loader returned null.
  return (
    <AcceptanceInitialBundle acceptanceId={acceptanceId} bundle={bundle}>
      <Suspense fallback={<WorkbenchLoading />}>
        {root?.embedConfig.embed ? <AcceptanceEmbed /> : <AcceptanceDetail />}
      </Suspense>
    </AcceptanceInitialBundle>
  );
}
