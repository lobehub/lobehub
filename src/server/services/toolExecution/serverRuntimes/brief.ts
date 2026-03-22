import { BriefIdentifier } from '@lobechat/builtin-tool-brief';
import { formatBriefCreated, formatCheckpointCreated } from '@lobechat/prompts';
import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';

import { type ServerRuntimeRegistration } from './types';

const createBriefRuntime = ({
  briefModel,
  taskId,
  taskModel,
}: {
  briefModel: BriefModel;
  taskId?: string;
  taskModel: TaskModel;
}) => ({
  createBrief: async (args: {
    actions?: Array<{ key: string; label: string; type: string }>;
    priority?: string;
    summary: string;
    title: string;
    type: string;
  }) => {
    const actions = args.actions || DEFAULT_BRIEF_ACTIONS[args.type] || [];

    const brief = await briefModel.create({
      actions,
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
    if (taskId) {
      await taskModel.updateStatus(taskId, 'paused');
    }

    await briefModel.create({
      priority: 'normal',
      summary: args.reason,
      taskId,
      title: 'Checkpoint requested',
      type: 'decision',
    });

    return { content: formatCheckpointCreated(args.reason), success: true };
  },
});

export const briefRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Brief tool execution');
    }

    const briefModel = new BriefModel(context.serverDB, context.userId);
    const taskModel = new TaskModel(context.serverDB, context.userId);

    return createBriefRuntime({ briefModel, taskId: context.taskId, taskModel });
  },
  identifier: BriefIdentifier,
};
