import { mergeRouters } from '@/libs/trpc/lambda';

import { queryRouter } from './query';
import { reEmbedRouter } from './reEmbed';
import { searchRouter } from './search';
import { toolWriteRouter } from './toolWrite';

export const userMemoriesRouter = mergeRouters(
  queryRouter,
  reEmbedRouter,
  searchRouter,
  toolWriteRouter,
);
