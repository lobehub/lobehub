import { createReplicaSlice, recordLens } from '@/libs/replica';
import { agentSignalService } from '@/services/agentSignal';
import type { StoreSetter } from '@/store/types';

import { type AgentSignalState } from './initialState';
import {
  AGENT_SIGNAL_RECEIPT_LIMIT,
  agentSignalReceiptsKey,
  agentSignalReceiptsResource,
  type AgentSignalReceiptView,
  mergeReceiptRefresh,
} from './projection';

type Setter = StoreSetter<AgentSignalState>;

export class AgentSignalPrivateAction {
  readonly receipts;
  /**
   * Consecutive polls per entry that brought no new receipt — polling backoff
   * bookkeeping only, never data, so it is not scoped to an identity.
   */
  readonly emptyRefreshes = new Map<string, number>();
  /**
   * Entries whose next read must be a full head: a topic opened again. An
   * incremental read only returns receipts newer than the head, so it never
   * carries a change to an older one (an Undo from another tab or device).
   */
  readonly fullHeadPending = new Set<string>();

  constructor(set: Setter, get: () => AgentSignalState) {
    this.receipts = createReplicaSlice(agentSignalReceiptsResource, {
      actionPrefix: 'agentSignalReceipts',
      fetcher: async (params) => {
        const key = agentSignalReceiptsKey(params);
        // Only a list the server answered this session may be extended
        // incrementally, and only while its topic stays open: a persisted one
        // can miss receipts and status changes made since, so the first read
        // after a reload or a revisit fetches the full head.
        const isConfirmed = get().agentSignalReceiptsReplica.entries[key]?.source === 'server';
        const isFullHead = this.fullHeadPending.has(key) || !isConfirmed;
        const sinceCreatedAt = isFullHead
          ? undefined
          : get().agentSignalReceiptsMap[key]?.[0]?.createdAt;

        const result = await agentSignalService.listReceipts({
          ...params,
          limit: AGENT_SIGNAL_RECEIPT_LIMIT,
          ...(sinceCreatedAt === undefined ? {} : { sinceCreatedAt }),
        });
        // Only a full head that answered settles the reopen: a failed one
        // leaves the intent for the retry.
        if (isFullHead) this.fullHeadPending.delete(key);

        this.emptyRefreshes.set(
          key,
          result.receipts.length === 0 ? (this.emptyRefreshes.get(key) ?? 0) + 1 : 0,
        );

        if (sinceCreatedAt === undefined) return result.receipts;
        // Merge into what is on screen now: a rollback may have patched a row
        // while the request was in flight.
        const current: AgentSignalReceiptView[] = get().agentSignalReceiptsMap[key] ?? [];
        return mergeReceiptRefresh(current, result.receipts);
      },
      get,
      set,
      stateKey: 'agentSignalReceiptsReplica',
      view: recordLens<AgentSignalState, AgentSignalReceiptView[]>('agentSignalReceiptsMap'),
    });
  }
}
