import type { AgentRunBoardRunStatus } from '@lobechat/types';
import { cssVar } from '@lobehub/ui';

import { type ExecutionStatusVisual, TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';

/**
 * The product's status glyphs and colors, so a run reads the same here as on
 * tasks and topics. Finished work is the bulk of a board and needs nothing from
 * anyone, so it recedes to gray and leaves color to what is live or stuck.
 */
export const RUN_STATUS_VISUALS: Record<AgentRunBoardRunStatus, ExecutionStatusVisual> = {
  done: { ...TASK_STATUS_VISUALS.completed, color: cssVar.colorTextQuaternary },
  failed: TASK_STATUS_VISUALS.failed,
  needs_human: TASK_STATUS_VISUALS.paused,
  running: TASK_STATUS_VISUALS.running,
  stopped: TASK_STATUS_VISUALS.canceled,
};
