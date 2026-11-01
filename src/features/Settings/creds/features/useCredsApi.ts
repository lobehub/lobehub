'use client';

import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';

/**
 * Personal vs workspace creds API binding.
 *
 * The personal page (`/settings/credential`) and the workspace page
 * (`/[workspaceSlug]/settings/credential`) share UI components but talk to
 * different tRPC routers — `market.creds` (Market user account) versus
 * `workspaceCreds` (Market organization mirroring the cloud workspace).
 * Lists, forms and modals take the binding explicitly; modals are portaled
 * to a global host, outside any page context.
 */
export interface CredsApi {
  client: typeof lambdaClient.market.creds;
  /**
   * Workspace bindings only: who a newly created credential is for —
   * `'public'` shares it with every member, `'private'` keeps it to its
   * creator. Unset for personal credentials.
   */
  createVisibility?: 'private' | 'public';
  query: typeof lambdaQuery.market.creds;
  /** Workspace bindings only: publish a workspace credential or take it back. */
  setVisibility?: (id: number, visibility: 'private' | 'public') => Promise<unknown>;
}

/**
 * Extra create-request fields for the binding — `workspaceCreds` accepts a
 * `visibility`; the personal `market.creds` takes none.
 */
export const createExtras = (credsApi: CredsApi) =>
  credsApi.createVisibility ? { visibility: credsApi.createVisibility } : {};

/** The personal `market.creds` binding. */
export const personalCredsApi: CredsApi = {
  client: lambdaClient.market.creds,
  query: lambdaQuery.market.creds,
};
