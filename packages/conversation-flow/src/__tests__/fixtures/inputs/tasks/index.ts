import type { Message } from '../../../../types';
import simple from './simple.json';
import withSummary from './with-summary.json';

export const tasks = {
  simple: simple as Message[],
  withSummary: withSummary as Message[],
};
