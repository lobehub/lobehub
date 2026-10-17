import { router } from '@/libs/trpc/lambda';

import { benchmarkProcedures } from './benchmarks';
import { datasetProcedures } from './datasets';
import { experimentProcedures } from './experiments';
import { runProcedures } from './runs';
import { testCaseProcedures } from './testCases';

export const agentEvalRouter = router({
  ...benchmarkProcedures,
  ...experimentProcedures,
  ...datasetProcedures,
  ...testCaseProcedures,
  ...runProcedures,
});
