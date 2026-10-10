import type { ConversationContext } from '@lobechat/types';
import { produce } from 'immer';

import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { Operation, OperationStatus } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import type { StoreSetter } from '@/store/types';

import { scheduleQueuedFollowUp } from '../lifecycle/queuedFollowUp';

const isUnsettled = (operation: Operation) =>
  operation.status === 'running' || operation.status === 'pending' || operation.status === 'paused';

export class ServerOperationReconciliationActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: StoreSetter<ChatStore>;

  constructor(set: StoreSetter<ChatStore>, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * A persisted terminal snapshot can outlive its Gateway completion event.
   * Retire only that server run's local operations; never interrupt the server
   * or replay notifications, tool callbacks, or topic-status writes.
   */
  reconcileServerOperation = (params: {
    operationId: string;
    status: Extract<OperationStatus, 'completed' | 'cancelled' | 'failed'>;
    topicId: string;
  }): void => {
    const state = this.#get();
    const roots = Object.values(state.operations).filter(
      (op) =>
        op.type === 'execServerAgentRuntime' &&
        op.context.topicId === params.topicId &&
        op.metadata.serverOperationId === params.operationId,
    );
    if (roots.length === 0) return;

    const owned = new Set(roots.map((op) => op.id));
    const visit = (id: string) => {
      for (const child of state.operations[id]?.childOperationIds ?? []) {
        if (owned.has(child)) continue;
        owned.add(child);
        visit(child);
      }
    };
    roots.forEach((op) => visit(op.id));
    if (![...owned].some((id) => state.operations[id] && isUnsettled(state.operations[id]))) return;

    const now = Date.now();
    this.#set(
      produce((draft: ChatStore) => {
        for (const id of owned) {
          const op = draft.operations[id];
          if (!op || !isUnsettled(op)) continue;
          op.status = params.status;
          op.metadata.terminalReconciled = true;
          op.metadata.endTime = now;
          op.metadata.duration = now - op.metadata.startTime;
        }
        // Streaming tool indicators are keyed by assistant message, separately
        // from the operation tree. Do not clear an indicator a newer run owns.
        for (const [messageId, operationId] of Object.entries(draft.messageOperationMap)) {
          if (owned.has(operationId)) delete draft.toolCallingStreamIds[messageId];
        }
      }),
      false,
      'reconcileServerOperation',
    );

    if (params.status !== 'completed') return;
    const scheduled = new Set<string>();
    for (const root of roots) {
      // A completed root may still have stale children; do not drain its queue
      // twice when only those children needed repair.
      if (!isUnsettled(root) || !root.context.agentId || root.context.scope === 'sub_agent')
        continue;
      const context = root.context as ConversationContext;
      const key = messageMapKey(context);
      if (
        scheduled.has(key) ||
        !state.queuedMessages[key]?.length ||
        operationSelectors.hasNewerConversationOperation(root.id, context)(this.#get())
      )
        continue;
      scheduled.add(key);
      scheduleQueuedFollowUp(this.#get, context, root.id);
    }
  };
}

export type ServerOperationReconciliationAction = Pick<
  ServerOperationReconciliationActionImpl,
  keyof ServerOperationReconciliationActionImpl
>;
