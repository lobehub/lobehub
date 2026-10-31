import { getComposioAppByIdentifier } from '@lobechat/const';
import { TRPCError } from '@trpc/server';

import { getServerComposioAuthConfigId } from '@/config/composio';

export interface ComposioAuthorizationClient {
  authConfigs: { list: () => Promise<any>; create: (appSlug: string, input: any) => Promise<any> };
  connectedAccounts: { link: (userId: string, authConfigId: string, input: any) => Promise<any> };
}

/** Shared by the existing web flow and the public native authorization flow. */
export const createComposioAuthorization = async (
  client: ComposioAuthorizationClient,
  input: {
    identifier: string;
    appSlug: string;
    userId: string;
    callbackUrl: string;
    allowMultiple?: boolean;
  },
) => {
  const app = getComposioAppByIdentifier(input.identifier);
  if (!app || app.appSlug.toLowerCase() !== input.appSlug.toLowerCase()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported Composio service' });
  }
  let authConfigId = getServerComposioAuthConfigId(input.identifier);
  if (!authConfigId) {
    const configs = await client.authConfigs.list();
    let config = configs?.items?.find(
      (item: any) => item.toolkit?.slug?.toLowerCase() === input.appSlug.toLowerCase(),
    );
    if (!config)
      config = await client.authConfigs.create(input.appSlug, {
        name: input.appSlug,
        type: 'use_composio_managed_auth',
      });
    authConfigId = config?.id;
  }
  if (!authConfigId)
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Authorization is not configured',
    });
  const linked = await client.connectedAccounts.link(input.userId, authConfigId, {
    callbackUrl: input.callbackUrl,
    ...(input.allowMultiple ? { allowMultiple: true } : {}),
  });
  return {
    authConfigId,
    connectedAccountId: linked.id as string,
    redirectUrl: linked.redirectUrl as string,
  };
};
