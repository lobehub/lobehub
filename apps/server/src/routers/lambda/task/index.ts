import { router } from '@/libs/trpc/lambda';

import { commentsProcedures } from './comments';
import { executionProcedures } from './execution';
import { lifecycleProcedures } from './lifecycle';
import { queriesProcedures } from './queries';
import { relationsProcedures } from './relations';
import { reviewProcedures } from './review';
import { updateProcedures } from './update';

export const taskRouter = router({
  ...lifecycleProcedures,
  ...relationsProcedures,
  ...commentsProcedures,
  ...executionProcedures,
  ...queriesProcedures,
  ...reviewProcedures,
  ...updateProcedures,
});
