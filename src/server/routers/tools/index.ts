import { publicProcedure, router } from '@/libs/trpc/lambda';

import { composioToolsRouter } from './composio';
import { klavisRouter } from './klavis';
import { marketRouter } from './market';
import { mcpRouter } from './mcp';
import { searchRouter } from './search';

export const toolsRouter = router({
  healthcheck: publicProcedure.query(() => "i'm live!"),
  composio: composioToolsRouter,
  klavis: klavisRouter,
  market: marketRouter,
  mcp: mcpRouter,
  search: searchRouter,
});

export type ToolsRouter = typeof toolsRouter;
