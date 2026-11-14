import { BRANDING_NAME } from '@lobechat/business-const';
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { SWRConfig, unstable_serialize } from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import { resolveRequestLocale } from '@/locales/requestLocale';

import SharedGoalView from '../../src/features/goal/SharedGoalView';
import { loadShareT } from '../../src/shell/createShareI18n';
import { cloudflareContext } from '../lib/cloudflareContext';
import { buildPageMeta, shareMetaDescription, truncateDescription } from '../lib/seo';
import { createServerLambdaClient } from '../lib/serverTrpc';

export const loader = async ({ context, params, request }: LoaderFunctionArgs) => {
  const shareId = params.id!;
  const locale = resolveRequestLocale(request);
  const apiBase = context.get(cloudflareContext).env.SHARE_API_BASE as string | undefined;

  // A private or missing share rejects here; the client view reads the same
  // key again and renders the matching error state.
  const sharedGoal = await createServerLambdaClient(request, apiBase)
    .goalShare.getSharedGoal.query({ shareId })
    .then((result) => result.data)
    .catch((error) => {
      console.error('[share] shared goal SSR fetch failed:', error);
      return null;
    });

  return {
    description: shareMetaDescription(await loadShareT(locale), 'goalDescription'),
    locale,
    shareId,
    sharedGoal,
  };
};

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  const goal = loaderData?.sharedGoal;
  const title = goal?.goal.title;

  return buildPageMeta({
    description:
      truncateDescription(goal?.report?.headline ?? goal?.goal.requirement) ??
      loaderData?.description ??
      '',
    locale: loaderData?.locale,
    title: title ? `${title} · ${BRANDING_NAME}` : BRANDING_NAME,
    type: 'article',
  });
};

export default function ShareGoalRoute() {
  const { shareId, sharedGoal } = useLoaderData<typeof loader>();

  return (
    <SWRConfig
      value={{
        fallback: sharedGoal ? { [unstable_serialize(shareKeys.goal(shareId))]: sharedGoal } : {},
      }}
    >
      <SharedGoalView />
    </SWRConfig>
  );
}
