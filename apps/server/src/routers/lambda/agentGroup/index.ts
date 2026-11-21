import { mergeRouters } from '@/libs/trpc/lambda';

import { lifecycleRouter } from './lifecycle';
import { lockRouter } from './lock';
import { membersRouter } from './members';
import { queryRouter } from './query';
import { transferRouter } from './transfer';
import { visibilityRouter } from './visibility';

export const agentGroupRouter = mergeRouters(
  membersRouter,
  transferRouter,
  lifecycleRouter,
  queryRouter,
  visibilityRouter,
  lockRouter,
);

export type AgentGroupRouter = typeof agentGroupRouter;
