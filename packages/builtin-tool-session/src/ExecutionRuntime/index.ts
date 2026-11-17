import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  GetSessionState,
  ListSessionsState,
  ReadSessionParams,
  SendToSessionParams,
  SessionSummary,
  StartSessionParams,
  StartSessionState,
  TopicIdParams,
} from '../types';

/** What the runtime needs from the host: the `subSession` service or its tRPC client. */
export interface SessionService {
  archive: (topicId: string) => Promise<unknown>;
  get: (topicId: string) => Promise<GetSessionState>;
  list: (openerTopicId: string) => Promise<SessionSummary[]>;
  read: (
    topicId: string,
    limit: number,
  ) => Promise<{ items: { content?: null | string; role: string }[] }>;
  send: (params: {
    message: string;
    sourceOperationId?: string;
    topicId: string;
  }) => Promise<{ delivery: 'queued' | 'started' }>;
  start: (
    params: StartSessionParams & { openerTopicId: string; sourceOperationId?: string },
  ) => Promise<StartSessionState>;
  stop: (topicId: string) => Promise<{ stopped: number }>;
}

/** The calling turn: the conversation that opens sub-sessions and the run that does it. */
export interface SessionRuntimeContext {
  operationId?: string;
  topicId?: null | string;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? 'Unknown error');

const fail = (error: unknown): BuiltinServerRuntimeOutput => {
  const message = errorMessage(error);
  return { content: message, error: { message, type: 'SessionError' }, success: false };
};

const MAX_MESSAGE_CHARS = 1500;

export class SessionExecutionRuntime {
  constructor(
    private readonly service: SessionService,
    private readonly context: SessionRuntimeContext,
  ) {}

  private requireTopic(): string {
    if (!this.context.topicId) {
      throw new Error('Sub-sessions can only be opened from a conversation (no current topic).');
    }
    return this.context.topicId;
  }

  async startSession(params: StartSessionParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const started = await this.service.start({
        ...params,
        openerTopicId: this.requireTopic(),
        sourceOperationId: this.context.operationId,
      });
      const where = started.branch
        ? ` in a new worktree on branch ${started.branch}`
        : started.workingDirectory
          ? ` in ${started.workingDirectory}`
          : '';
      return {
        content: `Started sub-session ${started.topicId}${where}. It runs on its own; its reply will be reported back here when its turn ends — do not poll it.`,
        state: started satisfies StartSessionState,
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async listSessions(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const sessions = await this.service.list(this.requireTopic());
      if (sessions.length === 0) {
        return {
          content: 'This conversation has no open sub-sessions.',
          state: { sessions },
          success: true,
        };
      }
      const lines = sessions.map(
        (item) =>
          `- ${item.topicId} [${item.state}] ${item.title ?? '(untitled)'} (agent ${item.agentId ?? '?'})`,
      );
      return {
        content: `Sub-sessions:\n${lines.join('\n')}`,
        state: { sessions } satisfies ListSessionsState,
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async getSession({ topicId }: TopicIdParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const session = await this.service.get(topicId);
      const reply = session.lastReply ? `\n\nLast reply:\n${session.lastReply}` : '';
      return {
        content: `Sub-session ${topicId} is ${session.state}.${reply}`,
        state: session,
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async readSession({
    limit = 30,
    topicId,
  }: ReadSessionParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { items } = await this.service.read(topicId, limit);
      const lines = items
        .filter((item) => typeof item.content === 'string' && item.content.trim())
        .map((item) => {
          const content = item.content!.trim();
          const clipped =
            content.length > MAX_MESSAGE_CHARS
              ? `${content.slice(0, MAX_MESSAGE_CHARS)}…`
              : content;
          return `[${item.role}] ${clipped}`;
        });
      return {
        content:
          lines.length > 0 ? lines.join('\n\n') : `Sub-session ${topicId} has no messages yet.`,
        state: { count: lines.length, topicId },
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async sendToSession({
    message,
    topicId,
  }: SendToSessionParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { delivery } = await this.service.send({
        message,
        sourceOperationId: this.context.operationId,
        topicId,
      });
      return {
        content:
          delivery === 'queued'
            ? `Sub-session ${topicId} is running; the message was queued behind its current turn.`
            : `Sent to sub-session ${topicId}; it started a new turn.`,
        state: { delivery, topicId },
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async stopSession({ topicId }: TopicIdParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { stopped } = await this.service.stop(topicId);
      return {
        content:
          stopped > 0
            ? `Stopped sub-session ${topicId}.`
            : `Sub-session ${topicId} was not running.`,
        state: { stopped, topicId },
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async archiveSession({ topicId }: TopicIdParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      await this.service.archive(topicId);
      return { content: `Archived sub-session ${topicId}.`, state: { topicId }, success: true };
    } catch (error) {
      return fail(error);
    }
  }
}
