/**
 * Lobe Message Executor — frontend entry.
 *
 * Composes the shared `MessageExecutor` + `MessageExecutionRuntime` from
 * `@lobechat/builtin-tool-message` with TRPC-backed adapters so the
 * frontend and server run the same orchestration / formatting code paths.
 *
 * Adding a new API only requires updating `MessageApiName` + the runtime;
 * the frontend executor inherits the new method automatically.
 */
import { MessageExecutionRuntime } from '@lobechat/builtin-tool-message/executionRuntime';
import { MessageExecutor } from '@lobechat/builtin-tool-message/executor';

import { trpcBotProvider, trpcMessageService } from './trpcAdapters';

const runtime = new MessageExecutionRuntime({
  botProvider: trpcBotProvider,
  service: trpcMessageService,
});

export const messageExecutor = new MessageExecutor(runtime);
