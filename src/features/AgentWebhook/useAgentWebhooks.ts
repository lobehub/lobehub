import type { InboundWebhookItem } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { inboundWebhookService } from '@/services/inboundWebhook';

/** SWR key; `useClientDataSWR` adds the active workspace, so each scope keeps its own list. */
export const AGENT_WEBHOOKS_SWR_KEY = 'agent-webhooks';

/**
 * One agent's custom webhooks (every agent's, without `agentId`), newest first, plus the local edits the page makes. Changes patch
 * the cached list in place, so the other webhooks do not jump while one is being handled.
 */
export const useAgentWebhooks = (agentId?: string) => {
  const { data, error, isLoading, mutate } = useClientDataSWR<InboundWebhookItem[]>(
    agentId ? [AGENT_WEBHOOKS_SWR_KEY, agentId] : [AGENT_WEBHOOKS_SWR_KEY],
    () => inboundWebhookService.list('generic', agentId),
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
