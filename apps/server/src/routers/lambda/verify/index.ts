import { mergeRouters, router } from '@/libs/trpc/lambda';

import { verifyRunReportProcedures } from '../verifyRunReport';
import { criteriaRouter } from './criteria';
import { executionRouter } from './execution';
import { ingestRouter } from './ingest';
import { reportsRouter } from './reports';
import { runsRouter } from './runs';

export const verifyRouter = mergeRouters(
  criteriaRouter,
  executionRouter,
  runsRouter,
  ingestRouter,
  reportsRouter,
  router({
    ...verifyRunReportProcedures,
  }),
);
