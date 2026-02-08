import type { Message } from '../../../../types';
import multiTasksWithSummary from './multi-tasks-with-summary.json';
import simple from './simple.json';
import singleTaskWithToolChain from './single-task-with-tool-chain.json';
import withAssistantGroup from './with-assistant-group.json';
import withSummary from './with-summary.json';

export const tasks = {
  multiTasksWithSummary: multiTasksWithSummary as Message[],
  simple: simple as Message[],
  singleTaskWithToolChain: singleTaskWithToolChain as Message[],
  withAssistantGroup: withAssistantGroup as Message[],
  withSummary: withSummary as Message[],
};
