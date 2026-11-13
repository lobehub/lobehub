import type { InboundWebhookItem } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { inboundWebhookService } from '@/services/inboundWebhook';

/** SWR key; `useClientDataSWR` adds the active workspace, so each scope keeps its own list. */
export const AUTOMATIONS_SWR_KEY = 'inbound-webhooks';

/**
 * The automation list, plus the two local edits its rows make. A check
 * returns the refreshed row and a delete removes one; both patch the cached
 * list in place instead of refetching it, so the other rows do not jump under
 * the user while one is being handled.
 */
export const useAutomationList = () => {
  const { data, error, isLoading, mutate } = useClientDataSWR<InboundWebhookItem[]>(
    [AUTOMATIONS_SWR_KEY],
    () => inboundWebhookService.list(),
  );

  const replaceRow = (next: InboundWebhookItem) =>
    mutate((rows) => rows?.map((row) => (row.id === next.id ? next : row)), {
      revalidate: false,
    });

  const removeRow = (id: string) =>
    mutate((rows) => rows?.filter((row) => row.id !== id), { revalidate: false });

  return { data, error, isLoading, reload: () => mutate(), removeRow, replaceRow };
};
