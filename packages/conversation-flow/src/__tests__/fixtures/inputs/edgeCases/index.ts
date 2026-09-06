import type { Message } from '../../../../types';
import optimisticAssistantBranch from './optimistic-assistant-branch.json';
import orphanThreadRoot from './orphan-thread-root.json';
import taskChildSupervisorSummary from './task-child-supervisor-summary.json';
import taskCompletionSignal from './task-completion-signal.json';
import tasksWithAssistantGroupSibling from './tasks-with-assistant-group-sibling.json';

export const edgeCases = {
  optimisticAssistantBranch: optimisticAssistantBranch as Message[],
  orphanThreadRoot: orphanThreadRoot as Message[],
  taskChildSupervisorSummary: taskChildSupervisorSummary as Message[],
  taskCompletionSignal: taskCompletionSignal as Message[],
  tasksWithAssistantGroupSibling: tasksWithAssistantGroupSibling as Message[],
};
