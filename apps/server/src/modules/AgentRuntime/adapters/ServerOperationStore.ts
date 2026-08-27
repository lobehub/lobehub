import type { AgentState, OperationStore } from '@lobechat/agent-runtime';

import { TopicModel } from '@/database/models/topic';
import { type LobeChatDatabase } from '@/database/type';

/**
 * Server {@link OperationStore} adapter. `clearRunningMark` drops the topic's
 * `runningOperation` so a reconnect doesn't re-trigger after completion.
 * Best-effort: missing topic/user is a no-op and failures are swallowed
 * (matches the prior server-local `finish` behavior).
 */
export class ServerOperationStore implements OperationStore {
  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string | undefined,
    private readonly workspaceId: string | undefined,
    private readonly topicId: string | undefined,
    private readonly operationId: string | undefined,
    private readonly loadAgentState?: (operationId: string) => Promise<AgentState | null>,
  ) {}

  /**
   * Compare-and-clear: only the operation the mark points at may clear it.
   *
   * A topic can host several concurrent operations — a `callAgent` /
   * `callSubAgent` / group-member run executes in an isolation thread on its
   * parent's topic and finishes long before the parent does. Clearing
   * unconditionally there wiped the parent's reconnect anchor mid-run, so every
   * later client open found no `runningOperation`, never opened a gateway
   * WebSocket, and rendered a frozen REST snapshot for the rest of the run.
   *
   * Mirrors the ownership guard the abandon path already applies
   * (`AbandonOperationService`).
   */
  async clearRunningMark(): Promise<void> {
    if (!this.topicId || !this.userId) return;
    try {
      const topicModel = new TopicModel(this.serverDB, this.userId, this.workspaceId);
      const topic = await topicModel.findById(this.topicId);
      const marker = topic?.metadata?.runningOperation;
      const markedOperationId = marker?.operationId;
      const isChild = marker?.childOperations?.some(
        (child) => child.operationId === this.operationId,
      );
      // No mark (already cleared) or someone else's mark — nothing of ours to drop.
      if (!markedOperationId || (markedOperationId !== this.operationId && !isChild)) return;

      // Settle rather than merely take: this clears the mark AND writes the
      // topic's terminal status in one transaction, under the same row lock.
      //
      // Taking it alone left `topics.status` on 'running' with the mark — the
      // only thing a later `settleRunningOperation` can match on — already
      // gone, so no server path could ever correct it. `finish` runs this
      // BEFORE publishing `execution_complete`, and the client only learns the
      // run ended from that event, so its own settle always arrived to a
      // cleared mark and returned 'missing'. The topic then depended entirely
      // on a fire-and-forget `markTopicUnread`, and when that did not land the
      // sidebar spun forever. Observed as topics stuck 'running' whose
      // `metadata.runningOperation` was present-and-JSON-null with their
      // operation rows already terminal.
      //
      // 'unread' is what the server can honestly assert: the run finished and
      // nothing here proves the user watched it. Only the client knows that, so
      // it corrects to 'active' on its own — with a mark-independent write,
      // since by then this call has legitimately consumed the mark.
      await topicModel.settleRunningOperation(this.topicId, this.operationId!, 'unread');
    } catch {
      // best-effort — swallow
    }
  }

  async loadState(operationId: string): Promise<AgentState | null> {
    return (await this.loadAgentState?.(operationId)) ?? null;
  }
}
