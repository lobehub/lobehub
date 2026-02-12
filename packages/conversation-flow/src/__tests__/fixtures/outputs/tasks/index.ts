import type { SerializedParseResult } from '../../index';
import simple from './simple.json';
import singleTaskWithToolChain from './single-task-with-tool-chain.json';
import withSummary from './with-summary.json';

export const tasks = {
  simple: simple as unknown as SerializedParseResult,
  singleTaskWithToolChain: singleTaskWithToolChain as unknown as SerializedParseResult,
  withSummary: withSummary as unknown as SerializedParseResult,
};
