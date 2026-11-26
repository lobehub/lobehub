import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';

import { taskService } from '@/services/task';

import type { SetTaskScheduleParams } from '../../types';

/**
 * The `channelDelivery` of a client `setTaskSchedule`, resolved and checked by the server before
 * anything is written: `{}` becomes where this run answers, and a refused delivery is `refused`, so
 * the schedule is left untouched too. `queue` adds the write once every check has passed.
 */
export const checkChannelDelivery = async (
  taskId: string,
  input: SetTaskScheduleParams['channelDelivery'],
  ctx?: BuiltinToolContext,
): Promise<
  | { queue: (ops: Promise<unknown>[], changes: string[]) => void; refused?: undefined }
  | { refused: BuiltinToolResult }
  | undefined
> => {
  if (input === undefined) return;
  try {
    const { delivery, description } = await taskService.checkChannelDelivery({
      delivery: input,
      id: taskId,
      ...(ctx?.operationId && { operationId: ctx.operationId }),
    });
    return {
      queue: (ops, changes) => {
        ops.push(taskService.updateConfig(taskId, { delivery }));
        changes.push(description);
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Channel delivery was refused';
    return {
      refused: {
        content: `Nothing was changed: ${message}`,
        error: { message, type: 'ChannelDeliveryRefused' },
        success: false,
      },
    };
  }
};
