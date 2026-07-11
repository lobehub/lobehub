import type { AgentRuntimeHost } from '@lobechat/agent-runtime';

import { ServerBlobStore } from './adapters/ServerBlobStore';
import { ServerCompressionTransport } from './adapters/ServerCompressionTransport';
import { ServerContextBuilder } from './adapters/ServerContextBuilder';
import { ServerLifecycleSink } from './adapters/ServerLifecycleSink';
import { ServerLLMTransport } from './adapters/ServerLLMTransport';
import { ServerMessageTransport } from './adapters/ServerMessageTransport';
import { ServerOperationStore } from './adapters/ServerOperationStore';
import { ServerStreamSink } from './adapters/ServerStreamSink';
import { ServerSubAgentTransport } from './adapters/ServerSubAgentTransport';
import { ServerToolTransport } from './adapters/ServerToolTransport';
import type { RuntimeExecutorContext } from './context';
import { buildPostProcessUrl } from './executorHelpers';

/**
 * Build the {@link AgentRuntimeHost} from the server's `RuntimeExecutorContext`:
 * wraps the concrete services (`MessageModel`, `IStreamEventManager`,
 * `TopicModel`) in transport adapters + assembles the operation context. This
 * is the "server only registers adapters" seam — package-hosted executors take
 * the host instead of the raw ctx.
 *
 * Keep concrete service construction here so package executors only see narrow
 * message, model, context, blob, stream, operation, and tool ports.
 */
export const buildHost = (ctx: RuntimeExecutorContext): AgentRuntimeHost => {
  const blob = ctx.userId
    ? new ServerBlobStore(ctx.serverDB, ctx.userId, ctx.workspaceId)
    : undefined;

  return {
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
      blob,
      compression: ctx.userId
        ? new ServerCompressionTransport(ctx.serverDB, ctx.userId, ctx.workspaceId)
        : undefined,
      context: new ServerContextBuilder(ctx),
      llm: ctx.userId ? new ServerLLMTransport(ctx, blob) : undefined,
      messages: new ServerMessageTransport(ctx.messageModel, {
        postProcessUrl: buildPostProcessUrl(ctx),
      }),
      operationStore: new ServerOperationStore(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId,
        ctx.topicId,
      ),
      stream: new ServerStreamSink(ctx.streamManager, ctx.operationId),
      subAgent: ctx.execSubAgent ? new ServerSubAgentTransport(ctx) : undefined,
      tools: new ServerToolTransport(ctx),
    },
  };
};
