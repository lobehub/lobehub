'use client';

import { useMemo } from 'react';

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
 */
const WorkspaceCredsSetting = () => {
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

  return (
    <CredsApiProvider value={workspaceCredsApi}>
      <Page />
    </CredsApiProvider>
  );
};

WorkspaceCredsSetting.displayName = 'WorkspaceCredsSetting';

export default WorkspaceCredsSetting;
