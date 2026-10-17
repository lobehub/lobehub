import { router } from '@/libs/trpc/lambda';

import { verifyRunReportProcedures } from '../verifyRunReport';
import { criteriaProcedures } from './criteria';
import { executionProcedures } from './execution';
import { ingestProcedures } from './ingest';
import { reportsProcedures } from './reports';
import { runsProcedures } from './runs';

export const verifyRouter = router({
  ...criteriaProcedures,
  ...executionProcedures,
  ...runsProcedures,
  ...ingestProcedures,
  ...reportsProcedures,
  ...verifyRunReportProcedures,
});
