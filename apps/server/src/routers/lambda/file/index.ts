import { mergeRouters } from '@/libs/trpc/lambda';

import { knowledgeItemsRouter } from './knowledgeItems';
import { queriesRouter } from './queries';
import { removeRouter } from './remove';
import { transferRouter } from './transfer';
import { updateRouter } from './update';
import { uploadRouter } from './upload';

export const fileRouter = mergeRouters(
  uploadRouter,
  queriesRouter,
  knowledgeItemsRouter,
  removeRouter,
  updateRouter,
  transferRouter,
);

export type FileRouter = typeof fileRouter;
