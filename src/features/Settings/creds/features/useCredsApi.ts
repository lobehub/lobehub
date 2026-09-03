'use client';

import { createContext, useContext } from 'react';

import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

/**
 * Personal vs workspace creds API binding.
 *
 * The personal page (`/settings/credential`) and the workspace page
 * (`/[workspaceSlug]/settings/credential`) share UI components but talk to
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

/**
 * The personal `market.creds` binding, exported so callers that need it
 * regardless of ambient context can use it explicitly — e.g. {@link CredsList}
 * routing a merged workspace-view row back to the personal API when its
 * `ownerType` is `'user'` (the row is a member's own credential, not the
 * org's), since only the owner's personal endpoint can write to it.
 */
export const defaultCredsApi: CredsApi = {
  client: lambdaClient.market.creds,
  query: lambdaQuery.market.creds,
};

const CredsApiContext = createContext<CredsApi | null>(null);

export const CredsApiProvider = CredsApiContext.Provider;

export const useCredsApi = (): CredsApi => useContext(CredsApiContext) ?? defaultCredsApi;
