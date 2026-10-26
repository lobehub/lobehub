import { notifyTaskAssigned } from '@/business/server/task/notifyTaskAssigned';
import { ProjectModel } from '@/database/models/project';
import { UserModel } from '@/database/models/user';
import { after } from '@/server/utils/scheduleAfterResponse';

import type { TaskRuntimeDeps } from './task';

type AssigneeCheck = { content: string; success: false } | { success: true };

/**
 * Assignee resolution and notification for the task runtime. Reads `deps`
 * lazily: the runtime factory swaps its models and workspace in after the
 * first call resolves the owning scope.
 */
export const createTaskAssigneeHelpers = (deps: TaskRuntimeDeps) => {
  // Project work goes to the project's own agents: the coordinator delegates
  // by assignment, so an agent nobody invited must not receive it.
  const checkProjectMember = async (
    assigneeAgentId: string,
    projectId: string,
  ): Promise<AssigneeCheck> => {
    if (!deps.db || !deps.userId) return { success: true };
    const projectModel = new ProjectModel(deps.db, deps.userId, deps.workspaceId);
    const [project, members] = await Promise.all([
      projectModel.findById(projectId),
      projectModel.listAgents(projectId),
    ]);
    // An unreadable project fails on write with its own error.
    if (!project || !members) return { success: true };
    // The main agent always takes project work, even when it is a shared agent
    // (or LobeAI after the main agent was cleared) without a member row.
    const [{ coordinatorAgentId }] = await projectModel.resolveCoordinatorAgents([project]);
    if (assigneeAgentId === coordinatorAgentId) return { success: true };
    const enabled = members.filter(({ binding }) => binding.enabled);
    if (enabled.some(({ agent }) => agent.id === assigneeAgentId)) return { success: true };

    const roster = enabled
      .map(
        ({ agent, binding }) =>
          `${agent.title || '(untitled agent)'} (${agent.id})${binding.role ? ` — ${binding.role}` : ''}`,
      )
      .join('; ');
    return {
      content: `Agent ${assigneeAgentId} is not a member of this project, so it cannot take project work. Assign one of the project members instead: ${roster || '(none)'}. If this agent should help, ask the user to invite it to the project first.`,
      success: false,
    };
  };

  const resolveAssigneeAgent = async (
    assigneeAgentId?: string | null,
    projectId?: string | null,
  ): Promise<AssigneeCheck> => {
    if (!assigneeAgentId) return { success: true };

    const exists = await deps.agentModel.existsById(assigneeAgentId);
    if (!exists) return { content: `Assignee agent not found: ${assigneeAgentId}`, success: false };

    return projectId ? checkProjectMember(assigneeAgentId, projectId) : { success: true };
  };

  // Human-readable label for a member assignee in tool output: "Alice (usr_1)".
  // Falls back to the bare id when no db is wired (unit tests) or lookup fails.
  const resolveMemberLabel = async (assigneeUserId: string): Promise<string> => {
    if (!deps.db) return assigneeUserId;
    try {
      const [user] = await UserModel.getDisplayInfoByIds(deps.db, [assigneeUserId]);
      const name = user?.fullName?.trim() || user?.username?.trim();
      return name ? `${name} (${assigneeUserId})` : assigneeUserId;
    } catch {
      return assigneeUserId;
    }
  };

  // Assignment ping (Linear-style), mirroring `task.create` in the router: the
  // runtime calls TaskService directly (to persist `context.origin`), so the
  // router's notify hook never fires for tool-created tasks. Delivered after
  // the response as best-effort work — the `@/business` slot defaults to a
  // no-op, and a rejecting implementation must not become an unhandled
  // rejection. Silent for self-assignment; the assignee lock already
  // guarantees the member can open the task (private tasks cannot be assigned
  // to anyone but their creator).
  const notifyMemberAssigned = (task: {
    assigneeUserId: string | null;
    id: string;
    identifier: string;
    name: string | null;
  }) => {
    const { assigneeUserId } = task;
    if (!assigneeUserId || !deps.userId || assigneeUserId === deps.userId) return;
    const params = {
      actorUserId: deps.userId,
      assigneeUserId,
      taskId: task.id,
      taskIdentifier: task.identifier,
      taskName: task.name,
      workspaceId: deps.workspaceId,
    };
    after(async () => {
      try {
        await notifyTaskAssigned(params);
      } catch (error) {
        console.error('[task-runtime] Failed to send assignment notification', error);
      }
    });
  };

  return { notifyMemberAssigned, resolveAssigneeAgent, resolveMemberLabel };
};
