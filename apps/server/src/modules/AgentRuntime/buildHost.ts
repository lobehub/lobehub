import type { AgentRuntimeHost } from '@lobechat/agent-runtime';

import { ServerLifecycleSink } from './adapters/ServerLifecycleSink';
import { ServerMessageTransport } from './adapters/ServerMessageTransport';
import { ServerOperationStore } from './adapters/ServerOperationStore';
import { ServerStreamSink } from './adapters/ServerStreamSink';
import { type RuntimeExecutorContext } from './context';

/**
 * Build the {@link AgentRuntimeHost} from the server's `RuntimeExecutorContext`:
 * wraps the concrete services (`MessageModel`, `IStreamEventManager`,
 * `TopicModel`) in transport adapters + assembles the operation context. This
 * is the "server only registers adapters" seam — package-hosted executors take
 * the host instead of the raw ctx.
 *
 * Grows as more executors migrate (tools / llm / context / blob / lifecycle
 * adapters get added here); today it covers the `finish` executor.
 */
export const buildHost = (ctx: RuntimeExecutorContext): AgentRuntimeHost => ({
  // Only present when the operation registered hooks — mirrors the prior
  // `if (ctx.hookDispatcher)` guard in the human-approve executor.
  lifecycle: ctx.hookDispatcher
    ? new ServerLifecycleSink(ctx.hookDispatcher, ctx.operationId)
    : undefined,
  operation: {
    operationId: ctx.operationId,
    stepIndex: ctx.stepIndex,
    topicId: ctx.topicId,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  },
  transports: {
    messages: new ServerMessageTransport(ctx.messageModel),
    operationStore: new ServerOperationStore(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId,
      ctx.topicId,
    ),
    stream: new ServerStreamSink(ctx.streamManager, ctx.operationId),
  },
});
