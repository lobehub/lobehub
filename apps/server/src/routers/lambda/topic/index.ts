import { mergeRouters } from '@/libs/trpc/lambda';

import { createRouter } from './create';
import { operationReadRouter } from './operationReads';
import { ownedWorktreeRouter } from './ownedWorktree';
import { queryRouter } from './queries';
import { removeRouter } from './remove';
import { shareRouter } from './share';
import { updateRouter } from './update';

export const topicRouter = mergeRouters(
  updateRouter,
  queryRouter,
  createRouter,
  removeRouter,
  shareRouter,
  operationReadRouter,
  ownedWorktreeRouter,
);

export type TopicRouter = typeof topicRouter;
