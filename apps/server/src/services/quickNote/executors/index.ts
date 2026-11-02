import { goalExecutor } from './goal';
import { taskExecutor } from './task';
import { toolCallExecutor } from './toolCall';
import { topicExecutor } from './topic';
import type { QuickNoteProposalExecutorRegistry } from './types';

export * from './schemas';
export { createQuickNoteTask, kickoffQuickNoteTask, scheduleQuickNoteTaskKickoff } from './task';
export * from './types';

/** One executor per Proposal kind. */
export const QUICK_NOTE_PROPOSAL_EXECUTORS: QuickNoteProposalExecutorRegistry = {
  goal: goalExecutor,
  task: taskExecutor,
  tool_call: toolCallExecutor,
  topic: topicExecutor,
};
