import { router } from '@/libs/trpc/lambda';

import { configProcedures } from './config';
import { editLockProcedures } from './editLock';
import { knowledgeProcedures } from './knowledge';
import { lifecycleProcedures } from './lifecycle';
import { routingProcedures } from './routing';
import { transferProcedures } from './transfer';
import { visibilityProcedures } from './visibility';

export type { AgentRouteResolution } from './routing';

export const agentRouter = router({
  ...lifecycleProcedures,
  ...visibilityProcedures,
  ...knowledgeProcedures,
  ...configProcedures,
  ...transferProcedures,
  ...routingProcedures,
  ...editLockProcedures,
});
