import { router } from './shared';
import { reembedRouter } from './reembed';
import { searchRouter } from './search';
import { toolsRouter } from './tools';

// Re-export searchUserMemories for potential external use
export { searchUserMemories } from './search';

export const userMemoriesRouter = router({
  ...reembedRouter._def.procedures,
  ...searchRouter._def.procedures,
  tools: toolsRouter,
});
