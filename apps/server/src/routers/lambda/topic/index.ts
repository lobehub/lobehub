import { router } from '@/libs/trpc/lambda';

import { createProcedures } from './create';
import { queryProcedures } from './queries';
import { removeProcedures } from './remove';
import { shareProcedures } from './share';
import { updateProcedures } from './update';

export const topicRouter = router({
  ...updateProcedures,
  ...queryProcedures,
  ...createProcedures,
  ...removeProcedures,
  ...shareProcedures,
});

export type TopicRouter = typeof topicRouter;
