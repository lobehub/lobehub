import type { SerializedParseResult } from '../../index';
import multiTasksWithSummary from './multi-tasks-with-summary.json';
import simple from './simple.json';
import singleTaskWithToolChain from './single-task-with-tool-chain.json';
import withAssistantGroup from './with-assistant-group.json';
import withSummary from './with-summary.json';

export const tasks = {
  multiTasksWithSummary: multiTasksWithSummary as unknown as SerializedParseResult,
  simple: simple as unknown as SerializedParseResult,
  singleTaskWithToolChain: singleTaskWithToolChain as unknown as SerializedParseResult,
  withAssistantGroup: withAssistantGroup as unknown as SerializedParseResult,
  withSummary: withSummary as unknown as SerializedParseResult,
};
