import { notifyTaskAssigned } from '@/business/server/task/notifyTaskAssigned';
import { after } from '@/server/utils/scheduleAfterResponse';

/**
 * Assignment ping (Linear-style), delivered after the response as best-effort
 * work. Silent for self-assignment; the assignee lock already guarantees the
 * member is active and can open the task (`assertAssigneeUserVisibilityCompat`
 * rejects private tasks assigned to anyone but their creator). Callers decide
 * whether the assignee actually changed.
 *
 * Shared by every write boundary that can assign a task — the tRPC mutation the
 * in-app editor calls and the REST create/patch the OpenAPI SDK is generated
 * from — so a task assigned through either one lands in the assignee's inbox
 * and the two cannot drift.
 */
export const notifyAssignedBestEffort = (
  ctx: { userId: string; workspaceId?: string | null },
  task: {
    assigneeUserId: string | null;
    id: string;
    identifier: string;
    name: string | null;
  },
): void => {
  const { assigneeUserId } = task;
  if (!assigneeUserId || assigneeUserId === ctx.userId) return;

  const params = {
    actorUserId: ctx.userId,
    assigneeUserId,
    taskId: task.id,
    taskIdentifier: task.identifier,
    taskName: task.name,
    workspaceId: ctx.workspaceId ?? undefined,
  };

  after(async () => {
    try {
      await notifyTaskAssigned(params);
    } catch (error) {
      console.error('[task] Failed to send assignment notification', error);
    }
  });
};
