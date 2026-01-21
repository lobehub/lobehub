import type { Message } from '../../../../types';
import multiTasksWithSummary from './multi-tasks-with-summary.json';
import simple from './simple.json';
import withSummary from './with-summary.json';

export const tasks = {
  multiTasksWithSummary: multiTasksWithSummary as Message[],
  simple: simple as Message[],
  withSummary: withSummary as Message[],
};
