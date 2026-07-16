'use client';

import { createContext, useContext } from 'react';

import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

/**
 * Personal vs workspace creds API binding.
 *
 * The personal page (`/settings/credential`) and the workspace page
 * (`/[workspaceSlug]/settings/creds`) share UI components but talk to
 * different tRPC routers — `market.creds` (Market user account) versus
 * `workspaceCreds` (Market organization mirroring the cloud workspace).
 *
 * The workspace shell wraps the page in {@link CredsApiProvider} with the
 * workspace bindings. Forms/modals read whichever client/query namespace is
 * active via {@link useCredsApi} and otherwise behave identically.
 */
export interface CredsApi {
  client: typeof lambdaClient.market.creds;
  query: typeof lambdaQuery.market.creds;
}

const defaultCredsApi: CredsApi = {
  client: lambdaClient.market.creds,
  query: lambdaQuery.market.creds,
};

const CredsApiContext = createContext<CredsApi | null>(null);

export const CredsApiProvider = CredsApiContext.Provider;

export const useCredsApi = (): CredsApi => useContext(CredsApiContext) ?? defaultCredsApi;
