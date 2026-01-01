import { publicProcedure, router } from '@/libs/trpc/lambda';

import { codeInterpreterRouter } from './codeInterpreter';
import { klavisRouter } from './klavis';
import { mcpRouter } from './mcp';
import { searchRouter } from './search';

export const toolsRouter = router({
  codeInterpreter: codeInterpreterRouter,
  healthcheck: publicProcedure.query(() => "i'm live!"),
  klavis: klavisRouter,
  mcp: mcpRouter,
  search: searchRouter,
});

export type ToolsRouter = typeof toolsRouter;
