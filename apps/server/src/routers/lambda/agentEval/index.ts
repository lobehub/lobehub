import { mergeRouters } from '@/libs/trpc/lambda';

import { benchmarkRouter } from './benchmarks';
import { datasetRouter } from './datasets';
import { environmentRouter } from './environments';
import { experimentRouter } from './experiments';
import { runRouter } from './runs';
import { testCaseRouter } from './testCases';

export const agentEvalRouter = mergeRouters(
  benchmarkRouter,
  experimentRouter,
  datasetRouter,
  environmentRouter,
  testCaseRouter,
  runRouter,
);
