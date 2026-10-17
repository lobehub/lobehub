import { router } from '@/libs/trpc/lambda';

import { knowledgeItemsProcedures } from './knowledgeItems';
import { queriesProcedures } from './queries';
import { removeProcedures } from './remove';
import { transferProcedures } from './transfer';
import { updateProcedures } from './update';
import { uploadProcedures } from './upload';

export const fileRouter = router({
  ...uploadProcedures,
  ...queriesProcedures,
  ...knowledgeItemsProcedures,
  ...removeProcedures,
  ...updateProcedures,
  ...transferProcedures,
});

export type FileRouter = typeof fileRouter;
