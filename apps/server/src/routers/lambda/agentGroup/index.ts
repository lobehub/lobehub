import { router } from '@/libs/trpc/lambda';

import { lifecycleProcedures } from './lifecycle';
import { lockProcedures } from './lock';
import { membersProcedures } from './members';
import { queryProcedures } from './query';
import { transferProcedures } from './transfer';
import { visibilityProcedures } from './visibility';

export const agentGroupRouter = router({
  ...membersProcedures,
  ...transferProcedures,
  ...lifecycleProcedures,
  ...queryProcedures,
  ...visibilityProcedures,
  ...lockProcedures,
});

export type AgentGroupRouter = typeof agentGroupRouter;
