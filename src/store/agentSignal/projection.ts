import { defineReplica } from '@/libs/replica';
import type { agentSignalService } from '@/services/agentSignal';

export type AgentSignalReceiptView = Awaited<
  ReturnType<typeof agentSignalService.listReceipts>
>['receipts'][number];

/** Receipts one request returns, and the most a topic's entry keeps. */
export const AGENT_SIGNAL_RECEIPT_LIMIT = 20;
/** Topics whose receipts survive a reload, most recently used first. */
const MAX_PERSISTED_RECEIPT_TOPICS = 30;

export interface AgentSignalReceiptsParams {
  agentId: string;
  topicId: string;
}

export const agentSignalReceiptsKey = ({ agentId, topicId }: AgentSignalReceiptsParams) =>
  `${agentId}/${topicId}`;

/**
 * The latest Agent Signal receipts of one agent's topic, newest first
 * (`agentSignalReceiptsMap[agentSignalReceiptsKey(params)]`). The persisted copy
 * paints the receipt chips on a cold start; the network then confirms it.
 */
export const agentSignalReceiptsResource = defineReplica<
  AgentSignalReceiptsParams,
  AgentSignalReceiptView[]
>({
  key: agentSignalReceiptsKey,
  name: 'agentSignalReceipts',
  persist: { maxEntries: MAX_PERSISTED_RECEIPT_TOPICS },
  storage: 'indexedDB',
  version: 1,
});

/** Fold an incremental (`sinceCreatedAt`) page into the receipts on screen. */
export const mergeReceiptRefresh = (
  currentReceipts: AgentSignalReceiptView[],
  newReceipts: AgentSignalReceiptView[],
) => {
  if (newReceipts.length === 0) return currentReceipts;

  const mergedById = new Map(currentReceipts.map((receipt) => [receipt.id, receipt]));

  for (const receipt of newReceipts) {
    mergedById.set(receipt.id, receipt);
  }

  return [...mergedById.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, AGENT_SIGNAL_RECEIPT_LIMIT);
};
