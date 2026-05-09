import { useRef } from 'react';
import useSWR from 'swr';

import { agentSignalService } from '@/services/agentSignal';

/** Poll cadence for the active conversation's Agent Signal receipt surface. */
const AGENT_SIGNAL_RECEIPT_INITIAL_REFRESH_INTERVAL_MS = 3000;

/** Upper bound for one backoff sleep so the receipt surface still catches late async work. */
const AGENT_SIGNAL_RECEIPT_MAX_REFRESH_INTERVAL_MS = 60_000;

/** Maximum time to wait for async Agent Signal receipts in the current agent/topic scope. */
const AGENT_SIGNAL_RECEIPT_POLLING_TIMEOUT_MS = 5 * 60_000;

export type AgentSignalReceiptView = Awaited<
  ReturnType<typeof agentSignalService.listReceipts>
>['receipts'][number];

export const useAgentSignalReceipts = (input: {
  agentId?: string | null;
  enabled?: boolean;
  pollingSignal?: string | null;
  topicId?: string | null;
}) => {
  // TODO: Migrate Agent Signal receipt visibility to a dedicated product capability flag.
  const shouldFetch = input.enabled === true && Boolean(input.agentId && input.topicId);
  const scopeKey = shouldFetch ? `${input.agentId}:${input.topicId}` : undefined;
  const pollingKey = shouldFetch ? `${scopeKey}:${input.pollingSignal ?? ''}` : undefined;
  const pollingKeyRef = useRef<string | undefined>(undefined);
  const scopeKeyRef = useRef<string | undefined>(undefined);
  const latestCreatedAtRef = useRef<number | undefined>(undefined);
  const pollingRef = useRef<{ emptyRefreshes: number; startedAt?: number }>({ emptyRefreshes: 0 });
  const receiptsRef = useRef<AgentSignalReceiptView[]>([]);

  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    latestCreatedAtRef.current = undefined;
    receiptsRef.current = [];
  }

  if (pollingKeyRef.current !== pollingKey) {
    pollingKeyRef.current = pollingKey;
    pollingRef.current = {
      emptyRefreshes: 0,
      ...(shouldFetch ? { startedAt: Date.now() } : {}),
    };
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
      pollingRef.current.emptyRefreshes =
        result.receipts.length === 0 ? pollingRef.current.emptyRefreshes + 1 : 0;

      return {
        ...result,
        receipts: nextReceipts,
      };
    },
    {
      refreshInterval: () => {
        if (!shouldFetch || pollingRef.current.startedAt === undefined) return 0;

        const elapsedMs = Date.now() - pollingRef.current.startedAt;
        const remainingMs = AGENT_SIGNAL_RECEIPT_POLLING_TIMEOUT_MS - elapsedMs;

        if (remainingMs <= 0) return 0;

        const emptyRefreshBackoffStep = Math.max(pollingRef.current.emptyRefreshes - 1, 0);
        const nextIntervalMs = Math.min(
          AGENT_SIGNAL_RECEIPT_INITIAL_REFRESH_INTERVAL_MS * 2 ** emptyRefreshBackoffStep,
          AGENT_SIGNAL_RECEIPT_MAX_REFRESH_INTERVAL_MS,
        );

        return Math.min(nextIntervalMs, remainingMs);
      },
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
