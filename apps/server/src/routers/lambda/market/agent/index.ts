import { router } from '@/libs/trpc/lambda';

import { forkProcedures } from './fork';
import { publishProcedures } from './publish';
import { readProcedures } from './read';

export const agentRouter = router({
  ...publishProcedures,

  ...forkProcedures,

  ...readProcedures,
});

export type AgentRouter = typeof agentRouter;
