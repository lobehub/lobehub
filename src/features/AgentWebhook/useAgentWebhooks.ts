import type { InboundWebhookItem } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { inboundWebhookService } from '@/services/inboundWebhook';

/** SWR key; `useClientDataSWR` adds the active workspace, so each scope keeps its own list. */
export const AGENT_WEBHOOKS_SWR_KEY = 'agent-webhooks';

/**
 * One agent's generic webhooks, newest first, plus the local edits the page makes. Changes patch
 * the cached list in place, so the other webhooks do not jump while one is being handled.
 */
export const useAgentWebhooks = (agentId: string) => {
  const { data, error, isLoading, mutate } = useClientDataSWR<InboundWebhookItem[]>(
    [AGENT_WEBHOOKS_SWR_KEY, agentId],
    async () =>
      (await inboundWebhookService.list(agentId)).filter((item) => item.kind === 'generic'),
  );

  const addRow = (item: InboundWebhookItem) =>
    mutate((rows) => [item, ...(rows ?? []).filter((row) => row.id !== item.id)], {
      revalidate: false,
    });
  const replaceRow = (next: InboundWebhookItem) =>
    mutate((rows) => rows?.map((row) => (row.id === next.id ? next : row)), {
      revalidate: false,
    });
  const removeRow = (id: string) =>
    mutate((rows) => rows?.filter((row) => row.id !== id), { revalidate: false });

  return { addRow, data, error, isLoading, reload: () => mutate(), removeRow, replaceRow };
};
