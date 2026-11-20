import { mergeRouters } from '@/libs/trpc/lambda';

import { configRouter } from './config';
import { editLockRouter } from './editLock';
import { knowledgeRouter } from './knowledge';
import { lifecycleRouter } from './lifecycle';
import { routingRouter } from './routing';
import { transferRouter } from './transfer';
import { visibilityRouter } from './visibility';

export type { AgentRouteResolution } from './routing';

export const agentRouter = mergeRouters(
  lifecycleRouter,
  visibilityRouter,
  knowledgeRouter,
  configRouter,
  transferRouter,
  routingRouter,
  editLockRouter,
);
