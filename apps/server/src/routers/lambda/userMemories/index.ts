import { router } from '@/libs/trpc/lambda';

import { queryProcedures } from './query';
import { reEmbedProcedures } from './reEmbed';
import { searchProcedures } from './search';
import { toolWriteProcedures } from './toolWrite';

export const userMemoriesRouter = router({
  ...queryProcedures,
  ...reEmbedProcedures,
  ...searchProcedures,
  ...toolWriteProcedures,
});
