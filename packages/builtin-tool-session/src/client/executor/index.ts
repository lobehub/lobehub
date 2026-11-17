import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { subSessionService } from '@/services/subSession';

import { SessionExecutionRuntime, type SessionService } from '../../ExecutionRuntime';
import { SessionIdentifier } from '../../manifest';
import type {
  ReadSessionParams,
  SendToSessionParams,
  StartSessionParams,
  TopicIdParams,
} from '../../types';
import { SessionApiName } from '../../types';

const service: SessionService = {
  archive: (topicId) => subSessionService.archive(topicId, 'self'),
  get: async (topicId) => {
    const session = await subSessionService.get(topicId);
    return { ...session, state: session.state as any, topicId };
  },
  list: async (openerTopicId) => (await subSessionService.list(openerTopicId)) as any,
  read: async (topicId, limit) => (await subSessionService.read(topicId, limit)) as any,
  send: (params) => subSessionService.send(params),
  start: async (params) => {
    const started = await subSessionService.start(params);
    return { ...started, operationId: started.operationId ?? undefined } as any;
  },
  stop: (topicId) => subSessionService.stop(topicId),
};

/** Client-side runs reach the same `subSession` service over tRPC. */
class SessionExecutor extends BaseExecutor<typeof SessionApiName> {
  readonly identifier = SessionIdentifier;
  protected readonly apiEnum = SessionApiName;

  private runtime = (ctx?: BuiltinToolContext) =>
    new SessionExecutionRuntime(service, { operationId: ctx?.operationId, topicId: ctx?.topicId });

  private toResult(output: Awaited<ReturnType<SessionExecutionRuntime['startSession']>>) {
    const message = output.error?.message ?? output.content ?? 'Sub-session call failed';
    return output.success
      ? ({
          content: output.content,
          state: output.state,
          success: true,
        } satisfies BuiltinToolResult)
      : ({
          content: output.content || message,
          error: { message, type: output.error?.type ?? 'SessionError' },
          state: output.state,
          success: false,
        } satisfies BuiltinToolResult);
  }

  startSession = async (params: StartSessionParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).startSession(params));

  listSessions = async (_params: unknown, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).listSessions());

  getSession = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).getSession(params));

  readSession = async (params: ReadSessionParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).readSession(params));

  sendToSession = async (params: SendToSessionParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).sendToSession(params));

  stopSession = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).stopSession(params));

  archiveSession = async (params: TopicIdParams, ctx?: BuiltinToolContext) =>
    this.toResult(await this.runtime(ctx).archiveSession(params));
}

export const sessionExecutor = new SessionExecutor();
