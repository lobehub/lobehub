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
      const markedOperationId = topic?.metadata?.runningOperation?.operationId;
      // No mark (already cleared) or someone else's mark — nothing of ours to drop.
      if (!markedOperationId || markedOperationId !== this.operationId) return;

      await topicModel.updateMetadata(this.topicId, { runningOperation: null });
    } catch {
      // best-effort — swallow
    }
  }

  async loadState(operationId: string): Promise<AgentState | null> {
    return (await this.loadAgentState?.(operationId)) ?? null;
  }
}
