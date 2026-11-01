import { useClientDataSWR } from '@/libs/swr';
import { authKeys } from '@/libs/swr/keys';
import { lambdaClient } from '@/libs/trpc/client';
import { type OAuthAppItem } from '@/types/oauthApp';

/**
 * The app list, shared by the list body and the page header (which hides its
 * Create button while the empty state shows its own). SWR dedupes the request.
 */
export const useOAuthAppList = (enabled = true) =>
  useClientDataSWR(enabled ? authKeys.oauthAppList() : null, async () => {
    const list = await lambdaClient.oauthApp.list.query();
    return list as OAuthAppItem[];
  });
