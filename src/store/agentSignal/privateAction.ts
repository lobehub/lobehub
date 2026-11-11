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

  constructor(set: Setter, get: () => AgentSignalState) {
    this.receipts = createReplicaSlice(agentSignalReceiptsResource, {
      actionPrefix: 'agentSignalReceipts',
      fetcher: async (params) => {
        const key = agentSignalReceiptsKey(params);
        // Only a list the server answered this session may be extended
        // incrementally: a persisted one can miss receipts and status changes
        // made since, so the first read after a reload fetches the full head.
        const isConfirmed = get().agentSignalReceiptsReplica.entries[key]?.source === 'server';
        const sinceCreatedAt = isConfirmed
          ? get().agentSignalReceiptsMap[key]?.[0]?.createdAt
          : undefined;

        const result = await agentSignalService.listReceipts({
          ...params,
          limit: AGENT_SIGNAL_RECEIPT_LIMIT,
          ...(sinceCreatedAt === undefined ? {} : { sinceCreatedAt }),
        });

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
