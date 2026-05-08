import { useRef } from 'react';
import useSWR from 'swr';

import { agentSignalService } from '@/services/agentSignal';

/** Poll cadence for the active conversation's Agent Signal receipt surface. */
const AGENT_SIGNAL_RECEIPT_REFRESH_INTERVAL_MS = 3000;

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
  const scopeKey = shouldFetch ? `${input.agentId}:${input.topicId}` : undefined;
  const scopeKeyRef = useRef<string | undefined>(undefined);
  const latestCreatedAtRef = useRef<number | undefined>(undefined);
  const receiptsRef = useRef<AgentSignalReceiptView[]>([]);

  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    latestCreatedAtRef.current = undefined;
    receiptsRef.current = [];
  }

  const { data, isLoading } = useSWR(
    shouldFetch ? ['agentSignalReceipts', input.agentId, input.topicId] : null,
    async () => {
      const result = await agentSignalService.listReceipts({
        agentId: input.agentId!,
        limit: 20,
        ...(latestCreatedAtRef.current === undefined
          ? {}
          : { sinceCreatedAt: latestCreatedAtRef.current }),
        topicId: input.topicId!,
      });

      const nextReceipts =
        latestCreatedAtRef.current === undefined
          ? result.receipts
          : mergeReceiptRefresh(receiptsRef.current, result.receipts);
      const latestCreatedAt = nextReceipts[0]?.createdAt;

      receiptsRef.current = nextReceipts;
      latestCreatedAtRef.current =
        latestCreatedAt === undefined ? latestCreatedAtRef.current : latestCreatedAt;

      return {
        ...result,
        receipts: nextReceipts,
      };
    },
    {
      refreshInterval: shouldFetch ? AGENT_SIGNAL_RECEIPT_REFRESH_INTERVAL_MS : 0,
      refreshWhenHidden: false,
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

const mergeReceiptRefresh = (
  currentReceipts: AgentSignalReceiptView[],
  newReceipts: AgentSignalReceiptView[],
) => {
  if (newReceipts.length === 0) return currentReceipts;

  const existingIds = new Set(currentReceipts.map((receipt) => receipt.id));

  return [...newReceipts.filter((receipt) => !existingIds.has(receipt.id)), ...currentReceipts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 20);
};
