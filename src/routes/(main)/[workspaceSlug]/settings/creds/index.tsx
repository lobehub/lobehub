'use client';

import { Flexbox } from '@lobehub/ui';
import { Empty } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useMarketAuth } from '@/layout/AuthProvider/MarketAuth';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import Page from '@/routes/(main)/settings/creds';
import {
  type CredsApi,
  CredsApiProvider,
} from '@/routes/(main)/settings/creds/features/useCredsApi';

/**
 * Workspace credential management.
 *
 * Reuses the personal `<Page />` shell but rebinds every CredsApi consumer
 * to the cloud `workspaceCreds.*` tRPC namespace via {@link CredsApiProvider}.
 * `workspaceCreds` resolves the active workspace to its Market organization
 * mirror and acts on the org's credential set so every workspace member sees
 * the same shared creds.
 *
 * When the workspace has no Market organization yet (Community Profile not
 * completed), the backend returns NOT_FOUND. This component intercepts that
 * error and renders a setup prompt instead of letting it bubble up as a
 * generic error boundary.
 */
const WorkspaceCredsSetting = () => {
  const { t } = useTranslation('setting');
  const { isAuthenticated } = useMarketAuth();

  const workspaceCredsApi = useMemo<CredsApi>(
    () => ({
      // The workspaceCreds router is a structural mirror of market.creds, but
      // strict typeof equality breaks because workspaceCreds is registered in
      // the cloud lambda namespace. Cast at the boundary; downstream consumers
      // only touch overlapping members (list/get/createKV/createOAuth/
      // createFile/update/delete/uploadFile/listOAuthConnections).
      client: lambdaClient.workspaceCreds as unknown as CredsApi['client'],
      query: lambdaQuery.workspaceCreds as unknown as CredsApi['query'],
    }),
    [],
  );

  // Pre-flight check: detect "org not set up" before rendering the full page.
  // React Query deduplicates this against the identical call inside CredsList,
  // so only one network request is made.
  const { error, isLoading } = workspaceCredsApi.query.list.useQuery(undefined, {
    enabled: isAuthenticated,
    // No retry for NOT_FOUND — the org won't materialise on its own.
    // Cap retries for other errors (500s, network) so failures surface instead of looping.
    retry: (failureCount, err) => {
      const code = (err as { data?: { code?: string } })?.data?.code;
      if (code === 'NOT_FOUND') return false;
      return failureCount < 3;
    },
  });

  if (isAuthenticated && !isLoading && error?.data?.code === 'NOT_FOUND') {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ padding: 48 }}>
        <Empty description={t('creds.orgSetupRequired')} />
      </Flexbox>
    );
  }

  return (
    <CredsApiProvider value={workspaceCredsApi}>
      <Page />
    </CredsApiProvider>
  );
};

WorkspaceCredsSetting.displayName = 'WorkspaceCredsSetting';

export default WorkspaceCredsSetting;
