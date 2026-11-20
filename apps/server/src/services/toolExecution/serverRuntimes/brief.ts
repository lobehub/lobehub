import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { formatBriefCreated, formatCheckpointCreated } from '@lobechat/prompts';
import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';

import { resolveTaskWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

export const briefRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Brief tool execution');
    }

    const db = context.serverDB;
    const userId = context.userId;
    const { agentId, taskId } = context;
    // A present task remains the durable scope anchor even when the pipeline
    // supplied workspaceId; validate both liveness and scope before writes.
    const resolveWs = async () => resolveTaskWorkspaceId(db, taskId, context.workspaceId);

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
