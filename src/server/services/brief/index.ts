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

export type BriefWithAgents = BriefItem & {
  agents: AgentAvatarInfo[];
  /** Parent task's automation mode — `schedule` marks a recurring task. */
  taskAutomationMode: 'heartbeat' | 'schedule' | null;
};

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
      return briefs.map((brief) => ({ ...brief, agents: [], taskAutomationMode: null }));
    }

    const [taskAgentIdsMap, taskRows] = await Promise.all([
      this.taskModel.getTreeAgentIdsForTaskIds(taskIds),
      this.taskModel.findByIds(taskIds),
    ]);
    const taskAutomationMap = Object.fromEntries(
      taskRows.map((t) => [t.id, t.automationMode ?? null]),
    );

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
      taskAutomationMode: brief.taskId ? (taskAutomationMap[brief.taskId] ?? null) : null,
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
   *
   * Recurring tasks (`automationMode === 'schedule'`) are also exempt: each
   * scheduled run produces its own `result` brief, but the task itself is the
   * recurring instruction — accepting one occurrence is a UI dismissal, not a
   * lifecycle terminal. The check is on the task's automation mode, not on the
   * brief's `cronJobId`, so a *manual* run of a recurring task is treated the
   * same way (cronJobId would be null in that case but the task is still
   * recurring).
   */
  async resolve(
    id: string,
    options?: { action?: string; comment?: string },
  ): Promise<BriefItem | null> {
    const brief = await this.briefModel.resolve(id, options);
    if (!brief) return null;

    if (options?.action === 'approve' && brief.taskId && brief.type === 'result') {
      const task = await this.taskModel.findById(brief.taskId);
      if (task && task.automationMode !== 'schedule') {
        await this.taskModel.updateStatus(brief.taskId, 'completed', { error: null });
      }
    }

    return brief;
  }
}
