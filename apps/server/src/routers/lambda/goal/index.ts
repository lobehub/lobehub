import { mergeRouters, router } from '@/libs/trpc/lambda';

import { goalGraphEditProcedures } from '../goalGraphEdit';
import { configurationRouter } from './configuration';
import { creationRouter } from './creation';
import { lifecycleRouter } from './lifecycle';
import { markRouter } from './marks';
import { objectiveRouter } from './objective';
import { planningRouter } from './planning';
import { readRouter } from './reads';
import { subscriptionRouter } from './subscriptions';
import { swarmRouter } from './swarm';
import { transferRouter } from './transfer';

export const goalRouter = mergeRouters(
  lifecycleRouter,
  markRouter,
  objectiveRouter,
  planningRouter,
  creationRouter,
  configurationRouter,
  readRouter,
  subscriptionRouter,
  swarmRouter,
  transferRouter,
  router({
    ...goalGraphEditProcedures,
  }),
);
