import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import type { BriefItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export interface AgentAvatarInfo {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  title: string | null;
}

export type BriefWithAgents = BriefItem & { agents: AgentAvatarInfo[] };

export class BriefService {
  private agentModel: AgentModel;
  private briefModel: BriefModel;
  private taskModel: TaskModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.agentModel = new AgentModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
    this.taskModel = new TaskModel(db, userId);
  }

  async enrichBriefsWithAgents(briefs: BriefItem[]): Promise<BriefWithAgents[]> {
    const taskIds = briefs.map((b) => b.taskId).filter((id): id is string => id !== null);

    if (taskIds.length === 0) {
      return briefs.map((brief) => ({ ...brief, agents: [] }));
    }

    const taskAgentIdsMap = await this.taskModel.getTreeAgentIdsForTaskIds(taskIds);

    const allAgentIds = [...new Set(Object.values(taskAgentIdsMap).flat())];
    let agentMap: Record<string, AgentAvatarInfo> = {};

    if (allAgentIds.length > 0) {
      const agentList = await this.agentModel.getAgentAvatarsByIds(allAgentIds);
      agentMap = Object.fromEntries(agentList.map((a) => [a.id, a]));
    }

    return briefs.map((brief) => ({
      ...brief,
      agents: (brief.taskId ? taskAgentIdsMap[brief.taskId] || [] : [])
        .map((id) => agentMap[id])
        .filter(Boolean),
    }));
  }

  async list(options?: { limit?: number; offset?: number; type?: string }) {
    const result = await this.briefModel.list(options);
    const data = await this.enrichBriefsWithAgents(result.briefs);
    return { briefs: data, total: result.total };
  }

  async listUnresolved() {
    const items = await this.briefModel.listUnresolved();
    return this.enrichBriefsWithAgents(items);
  }

  /**
   * Resolve a brief and propagate accept signals to the task lifecycle.
   *
   * Terminal accept rule: `approve` on a `result` brief completes the task. The
   * `result` type is the only brief that carries terminal-deliverable semantics
   * — the agent's `result` brief is a *proposal* of completion that the user
   * accepts here (and the review max-iterations force-pass also surfaces a
   * `result` brief for the same reason).
   *
   * `decision` briefs are non-terminal checkpoints (mid-execution approvals
   * like "should I proceed with X?") — approving them must NOT move the task to
   * `completed`, otherwise resume/continue flows break. Other actions
   * (feedback / retry / acknowledge) likewise do not transition task status
   * here; retry triggers re-execution via a separate flow.
   */
  async resolve(
    id: string,
    options?: { action?: string; comment?: string },
  ): Promise<BriefItem | null> {
    const brief = await this.briefModel.resolve(id, options);
    if (!brief) return null;

    if (options?.action === 'approve' && brief.taskId && brief.type === 'result') {
      await this.taskModel.updateStatus(brief.taskId, 'completed', { error: null });
    }

    return brief;
  }
}
