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
    private readonly loadAgentState?: (operationId: string) => Promise<AgentState | null>,
  ) {}

  async clearRunningMark(): Promise<void> {
    if (!this.topicId || !this.userId) return;
    try {
      const topicModel = new TopicModel(this.serverDB, this.userId, this.workspaceId);
      await topicModel.updateMetadata(this.topicId, { runningOperation: null });
    } catch {
      // best-effort — swallow
    }
  }

  async loadState(operationId: string): Promise<AgentState | null> {
    return (await this.loadAgentState?.(operationId)) ?? null;
  }
}
