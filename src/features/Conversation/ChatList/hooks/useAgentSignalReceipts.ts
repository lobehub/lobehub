import useSWR from 'swr';

import { agentSignalService } from '@/services/agentSignal';

export type AgentSignalReceiptView = Awaited<
  ReturnType<typeof agentSignalService.listReceipts>
>['receipts'][number];

export const useAgentSignalReceipts = (input: {
  agentId?: string | null;
  enabled?: boolean;
  topicId?: string | null;
}) => {
  // TODO: Migrate Agent Signal receipt visibility to a dedicated product capability flag.
  const shouldFetch = input.enabled === true && Boolean(input.agentId && input.topicId);
  const { data, isLoading } = useSWR(
    shouldFetch ? ['agentSignalReceipts', input.agentId, input.topicId] : null,
    () =>
      agentSignalService.listReceipts({
        agentId: input.agentId!,
        limit: 20,
        topicId: input.topicId!,
      }),
    {
      revalidateOnFocus: false,
    },
  );

  const receipts = data?.receipts ?? [];

  const receiptsByAnchor = new Map<string, AgentSignalReceiptView[]>();
  const unanchoredReceipts: AgentSignalReceiptView[] = [];

  for (const receipt of receipts) {
    if (!receipt.anchorMessageId) {
      unanchoredReceipts.push(receipt);
      continue;
    }

    receiptsByAnchor.set(receipt.anchorMessageId, [
      ...(receiptsByAnchor.get(receipt.anchorMessageId) ?? []),
      receipt,
    ]);
  }

  return {
    isLoading,
    receiptsByAnchor,
    unanchoredReceipts,
  };
};
