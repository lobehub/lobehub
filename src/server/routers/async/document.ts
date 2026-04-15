import { asyncRouter as router } from '@/libs/trpc/async';

export const documentRouter = router({
  // Document history compaction is no longer needed with the simplified history schema
});
