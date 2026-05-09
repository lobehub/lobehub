import type { TaskStatus } from '@lobechat/types';

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

export type BriefWithAgent = BriefItem & {
  /** Avatar of the agent that produced this brief; `null` when the brief has no `agentId` or the agent has been deleted. */
  agent: AgentAvatarInfo | null;
  /** Agents related to this brief, ordered with the direct producing agent before task-tree agents. */
  agents: AgentAvatarInfo[];
  /** Parent task's runtime status — `scheduled` marks a task parked between automated runs. */
  taskStatus: TaskStatus | null;
};

export class BriefService {
  private agentModel: AgentModel;
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private taskModel: TaskModel;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
    this.agentModel = new AgentModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
    this.taskModel = new TaskModel(db, userId);
  }

  /**
   * Lightweight enrich for callers that only need the direct producing agent
   * (e.g. task detail, where the surrounding payload already covers task tree
   * + status). Skips the recursive task-tree CTE and `taskFindByIds` round
   * trip used by {@link enrichBriefsWithAgents}.
   */
  async enrichBriefAgentOnly(
    briefs: BriefItem[],
  ): Promise<(BriefItem & { agent: AgentAvatarInfo | null })[]> {
    const directAgentIds = [
      ...new Set(briefs.map((b) => b.agentId).filter((id): id is string => !!id)),
    ];
    if (directAgentIds.length === 0) {
      return briefs.map((brief) => ({ ...brief, agent: null }));
    }

    const agentList = await this.agentModel.getAgentAvatarsByIds(directAgentIds);
    const agentMap: Record<string, AgentAvatarInfo> = Object.fromEntries(
      agentList.map((a) => [a.id, a]),
    );

    return briefs.map((brief) => ({
      ...brief,
      agent: brief.agentId ? (agentMap[brief.agentId] ?? null) : null,
    }));
  }

  /**
   * Enrich briefs with the producing agent + parent task status (always),
   * plus optionally the full task-tree agent roster (`agents[]`).
   *
   * `includeTreeAgents` defaults to `false` because no current consumer
   * renders `brief.agents[]` — `BriefCard` only uses `brief.agent`. Skipping
   * the recursive task-tree CTE turns the previous waterfall (CTE, then
   * `getAgentAvatars` once tree ids are known) into two truly parallel SQLs
   * (`taskFindByIds` + `getAgentAvatars` over direct agents only). Pass
   * `true` if a future caller actually needs the tree roster.
   */
  async enrichBriefsWithAgents(
    briefs: BriefItem[],
    options: { includeTreeAgents?: boolean } = {},
  ): Promise<BriefWithAgent[]> {
    const { includeTreeAgents = false } = options;
    const taskIds = [...new Set(briefs.map((b) => b.taskId).filter((id): id is string => !!id))];
    const directAgentIds = [
      ...new Set(briefs.map((b) => b.agentId).filter((id): id is string => !!id)),
    ];
    if (taskIds.length === 0 && directAgentIds.length === 0) {
      return briefs.map((brief) => ({ ...brief, agent: null, agents: [], taskStatus: null }));
    }

    const treeAgentIdsByTaskId =
      includeTreeAgents && taskIds.length > 0
        ? await this.taskModel.getTreeAgentIdsForTaskIds(taskIds)
        : ({} as Record<string, string[]>);
    const allAgentIds = [
      ...new Set([...directAgentIds, ...Object.values(treeAgentIdsByTaskId).flat()]),
    ];

    const [taskRows, agentList] = await Promise.all([
      taskIds.length > 0 ? this.taskModel.findByIds(taskIds) : Promise.resolve([]),
      allAgentIds.length > 0
        ? this.agentModel.getAgentAvatarsByIds(allAgentIds)
        : Promise.resolve([]),
    ]);

    const taskStatusMap = Object.fromEntries(
      taskRows.map((t) => [t.id, (t.status as TaskStatus) ?? null]),
    );
    const agentMap: Record<string, AgentAvatarInfo> = Object.fromEntries(
      agentList.map((a) => [a.id, a]),
    );

    return briefs.map((brief) => {
      let agents: AgentAvatarInfo[] = [];
      if (includeTreeAgents) {
        const briefAgentIds = new Set<string>();
        if (brief.agentId) briefAgentIds.add(brief.agentId);
        if (brief.taskId) {
          for (const agentId of treeAgentIdsByTaskId[brief.taskId] ?? []) {
            briefAgentIds.add(agentId);
          }
        }
        agents = [...briefAgentIds]
          .map((agentId) => agentMap[agentId])
          .filter((agent): agent is AgentAvatarInfo => Boolean(agent));
      }

      return {
        ...brief,
        agent: brief.agentId ? (agentMap[brief.agentId] ?? null) : null,
        agents,
        taskStatus: brief.taskId ? (taskStatusMap[brief.taskId] ?? null) : null,
      };
    });
  }

  async list(options?: { limit?: number; offset?: number; type?: string }) {
    const result = await this.briefModel.list(options);
    const data = await this.enrichBriefsWithAgents(result.briefs);
    return { briefs: data, total: result.total };
  }

  /**
   * Home Daily Brief feed. Uses the JOIN-based model query so the producing
   * agent + parent task status come back in a single round trip — no
   * separate enrichment pass.
   */
  async listUnresolved(): Promise<BriefWithAgent[]> {
    const rows = await this.briefModel.listUnresolvedEnriched();
    return rows.map(
      ({ brief, agentRowId, agentAvatar, agentBackgroundColor, agentTitle, taskStatus }) => ({
        ...brief,
        agent: agentRowId
          ? {
              avatar: agentAvatar,
              backgroundColor: agentBackgroundColor,
              id: agentRowId,
              title: agentTitle,
            }
          : null,
        agents: [],
        taskStatus: (taskStatus as TaskStatus) ?? null,
      }),
    );
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
   * Tasks parked at `status === 'scheduled'` are also exempt: that status means
   * the task is between automated runs (heartbeat or schedule), so approving
   * one occurrence's `result` brief is a UI dismissal, not a lifecycle
   * terminal — the next tick must still surface. Discriminating on the runtime
   * `status` (rather than `automationMode`) also means a manual run of a
   * recurring task — which leaves the task in `scheduled` between runs — is
   * handled the same way.
   */
  async resolve(
    id: string,
    options?: { action?: string; comment?: string },
  ): Promise<BriefItem | null> {
    const brief = await this.briefModel.resolve(id, options);
    if (!brief) return null;

    if (options?.action === 'approve' && brief.taskId && brief.type === 'result') {
      const task = await this.taskModel.findById(brief.taskId);
      if (task && task.status !== 'scheduled') {
        await this.taskModel.updateStatus(brief.taskId, 'completed', { error: null });
        // Cascade to downstream tasks whose dependencies are now satisfied.
        // Without this, dependents stay in `backlog` until the user manually
        // triggers them — defeating the point of the dependency edge.
        // Lazy-loaded to avoid pulling ModelRuntime into BriefService's
        // import graph (TaskRunner → TaskLifecycle → ModelRuntime).
        const { TaskRunnerService } = await import('@/server/services/taskRunner');
        const runner = new TaskRunnerService(this.db, this.userId);
        await runner.cascadeOnCompletion(brief.taskId);
      }
    }

    return brief;
  }
}
