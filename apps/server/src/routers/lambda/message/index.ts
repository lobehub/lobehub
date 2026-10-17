import { router } from '@/libs/trpc/lambda';

import { analyticsProcedures } from './analytics';
import { readProcedures } from './reads';
import { removalProcedures } from './removal';
import { toolMessageProcedures } from './toolMessages';
import { topicTreeProcedures } from './topicTree';
import { writeProcedures } from './writes';

export const messageRouter = router({
  ...writeProcedures,
  ...topicTreeProcedures,
  ...analyticsProcedures,
  ...readProcedures,
  ...removalProcedures,
  ...toolMessageProcedures,
});
