import { mergeRouters } from '@/libs/trpc/lambda';

import { commentsRouter } from './comments';
import { executionRouter } from './execution';
import { lifecycleRouter } from './lifecycle';
import { queriesRouter } from './queries';
import { relationsRouter } from './relations';
import { reviewRouter } from './review';
import { updateRouter } from './update';

export const taskRouter = mergeRouters(
  lifecycleRouter,
  relationsRouter,
  commentsRouter,
  executionRouter,
  queriesRouter,
  reviewRouter,
  updateRouter,
);
