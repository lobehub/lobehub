import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import type { LobeChatDatabase } from '@lobechat/database';
import { formatBriefCreated, formatCheckpointCreated } from '@lobechat/prompts';
import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { tasks } from '@/database/schemas';

import { type ServerRuntimeRegistration } from './types';

// Row-level fallback: the agent-runtime hasn't threaded `workspaceId` into
// `ToolExecutionContext` yet, so we resolve it from the task row when the
// runtime fires inside a task. Falls back to undefined (personal mode) when
// there is no task association.
const resolveWorkspaceId = async (
  db: LobeChatDatabase,
  taskId: string | undefined,
): Promise<string | undefined> => {
  if (!taskId) return undefined;
  const [row] = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.workspaceId ?? undefined;
};

export const briefRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Brief tool execution');
    }

    const db = context.serverDB;
    const userId = context.userId;
    const { agentId, taskId } = context;
    // Prefer the workspaceId threaded through the pipeline. Fall back to the
    // owning task row when an older caller still doesn't populate it.
    const resolveWs = async () => context.workspaceId ?? (await resolveWorkspaceId(db, taskId));

    return {
      createBrief: async (args: {
        actions?: Array<{ key: string; label: string; type: string }>;
        priority?: string;
        summary: string;
        title: string;
        type: string;
      }) => {
        // 'result' briefs are terminal — the UI hardcodes a single approve action
        // and routes it through BriefService.resolve to complete the task. Custom
        // actions on result briefs would be ignored, so reject them at the source.
        const actions =
          args.type === 'result' ? null : args.actions || DEFAULT_BRIEF_ACTIONS[args.type] || [];

        const workspaceId = await resolveWs();
        const briefModel = new BriefModel(db, userId, workspaceId);

        const brief = await briefModel.create({
          actions,
          agentId,
          priority: args.priority || 'info',
          summary: args.summary,
          taskId,
          title: args.title,
          type: args.type,
        });

        return {
          content: formatBriefCreated({
            id: brief.id,
            priority: args.priority || 'info',
            summary: args.summary,
            title: args.title,
            type: args.type,
          }),
          success: true,
        };
      },

      requestCheckpoint: async (args: { reason: string }) => {
        const workspaceId = await resolveWs();
        const briefModel = new BriefModel(db, userId, workspaceId);
        const taskModel = new TaskModel(db, userId, workspaceId);

        if (taskId) {
          await taskModel.updateStatus(taskId, 'paused');
        }

        await briefModel.create({
          agentId,
          priority: 'normal',
          summary: args.reason,
          taskId,
          title: 'Checkpoint requested',
          type: 'decision',
        });

        return { content: formatCheckpointCreated(args.reason), success: true };
      },
    };
  },
  identifier: BriefIdentifier,
};
