import { type ReplicaSyncResult } from '@/libs/replica';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type AgentSignalState, initialState } from './initialState';
import { AgentSignalPrivateAction } from './privateAction';
import { agentSignalReceiptsKey, type AgentSignalReceiptsParams } from './projection';
import { useAgentSignalStore } from './store';

const n = setNamespace('agentSignal');

type Setter = StoreSetter<AgentSignalState>;

/**
 * Collapse mounts of the same topic (main chat + a floating panel) into one
 * request. SWR dedupes poll ticks too, so this stays below the shortest poll.
 */
const RECEIPTS_DEDUPING_INTERVAL = 2000;

interface UseFetchReceiptsOptions {
  /** Poll cadence, decided per tick (see `useAgentSignalReceipts`). */
  refreshInterval?: () => number;
}

export class AgentSignalActionImpl {
  readonly #private: AgentSignalPrivateAction;
  readonly #set: Setter;

  constructor(set: Setter, _get: () => AgentSignalState, privateAction: AgentSignalPrivateAction) {
    this.#set = set;
    this.#private = privateAction;
  }

  /**
   * Fetch orchestration for one topic's receipts. Read them with
   * `agentSignalSelectors.getReceipts`, not from the return value.
   */
  useFetchReceipts = (
    params: AgentSignalReceiptsParams | null,
    { refreshInterval }: UseFetchReceiptsOptions = {},
  ): ReplicaSyncResult =>
    this.#private.receipts.useSync(params, {
      dedupingInterval: RECEIPTS_DEDUPING_INTERVAL,
      refreshInterval,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
    });

  /** Polls in a row that brought no new receipt for this topic. */
  getEmptyRefreshes = (params: AgentSignalReceiptsParams): number =>
    this.#private.emptyRefreshes.get(agentSignalReceiptsKey(params)) ?? 0;

  /** Make the topic's next read a full head, when the topic is opened (again). */
  requestFullReceiptHead = (params: AgentSignalReceiptsParams): void => {
    this.#private.fullHeadPending.add(agentSignalReceiptsKey(params));
  };

  /** Restart the polling backoff, when new work starts in the topic. */
  resetReceiptPolling = (params: AgentSignalReceiptsParams): void => {
    this.#private.emptyRefreshes.delete(agentSignalReceiptsKey(params));
  };

  /**
   * Record a server-confirmed rollback on the receipt, persisted, so a reload
   * does not paint the receipt as still undoable. Incremental polls only fetch
   * receipts newer than the head, so they would never carry this change.
   */
  markReceiptRolledBack = (params: AgentSignalReceiptsParams, receiptId: string): void => {
    this.#private.receipts.update(agentSignalReceiptsKey(params), (receipts) =>
      receipts?.map((receipt) =>
        receipt.id === receiptId
          ? { ...receipt, metadata: { ...receipt.metadata, rollbackStatus: 'rolled_back' } }
          : receipt,
      ),
    );
  };

  reset = (): void => {
    this.#set(initialState, false, n('reset'));
  };
}

const { getState, setState } = useAgentSignalStore;

export const agentSignalActions = new AgentSignalActionImpl(
  setState,
  getState,
  new AgentSignalPrivateAction(setState, getState),
);
