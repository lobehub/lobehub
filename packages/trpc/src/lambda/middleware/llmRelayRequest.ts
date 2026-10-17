import { runWithLlmRelayRequest } from '@/server/modules/AgentRuntime/llmRelay/requestScope';

import { trpc } from '../init';

/**
 * Runs the procedure as a request whose LLM calls to a device-only provider
 * are relayed back to the tab that sent it (`ctx.llmRelay`, from the one-shot
 * relay headers). A no-op for requests without them.
 */
export const llmRelayRequest = trpc.middleware(async ({ ctx, next }) =>
  runWithLlmRelayRequest(ctx.llmRelay, ctx.userId, () => next()),
);
