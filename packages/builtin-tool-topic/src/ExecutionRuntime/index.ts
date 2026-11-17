import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  GetTopicState,
  ListTopicsState,
  OpenTopicParams,
  OpenTopicState,
  ReadTopicParams,
  SendToTopicParams,
  SubTopicSummary,
  TopicIdParams,
} from '../types';

/** What the runtime needs from the host: the `subTopic` service or its tRPC client. */
export interface SubTopicToolService {
  archive: (topicId: string) => Promise<unknown>;
  get: (topicId: string) => Promise<GetTopicState>;
  list: (openerTopicId: string) => Promise<SubTopicSummary[]>;
  open: (
    params: OpenTopicParams & { openerTopicId: string; sourceOperationId?: string },
  ) => Promise<OpenTopicState>;
  read: (
    topicId: string,
    limit: number,
  ) => Promise<{ items: { content?: null | string; role: string }[] }>;
  send: (params: {
    message: string;
    sourceOperationId?: string;
    topicId: string;
  }) => Promise<{ delivery: 'queued' | 'started' }>;
  stop: (topicId: string) => Promise<{ stopped: number }>;
}

/** The calling turn: the conversation that opens sub-topics and the run that does it. */
export interface TopicToolRuntimeContext {
  operationId?: string;
  topicId?: null | string;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error ?? 'Unknown error');

const fail = (error: unknown): BuiltinServerRuntimeOutput => {
  const message = errorMessage(error);
  return { content: message, error: { message, type: 'SubTopicError' }, success: false };
};

const MAX_MESSAGE_CHARS = 1500;

export class TopicToolExecutionRuntime {
  constructor(
    private readonly service: SubTopicToolService,
    private readonly context: TopicToolRuntimeContext,
  ) {}

  private requireTopic(): string {
    if (!this.context.topicId) {
      throw new Error('Sub-topics can only be opened from a conversation (no current topic).');
    }
    return this.context.topicId;
  }

  async openTopic(params: OpenTopicParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const started = await this.service.open({
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
        content: params.detach
          ? `Opened topic ${started.topicId}${where}, detached: it is not linked to this conversation and will not report back.`
          : `Started sub-topic ${started.topicId}${where}. It runs on its own; its reply will be reported back here when its turn ends — do not poll it.`,
        state: started satisfies OpenTopicState,
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async listTopics(): Promise<BuiltinServerRuntimeOutput> {
    try {
      const topics = await this.service.list(this.requireTopic());
      if (topics.length === 0) {
        return {
          content: 'This conversation has no open sub-topics.',
          state: { topics },
          success: true,
        };
      }
      const lines = topics.map(
        (item) =>
          `- ${item.topicId} [${item.state}] ${item.title ?? '(untitled)'} (agent ${item.agentId ?? '?'})`,
      );
      return {
        content: `Sub-topics:\n${lines.join('\n')}`,
        state: { topics } satisfies ListTopicsState,
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async getTopic({ topicId }: TopicIdParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const subTopic = await this.service.get(topicId);
      const reply = subTopic.lastReply ? `\n\nLast reply:\n${subTopic.lastReply}` : '';
      return {
        content: `Sub-topic ${topicId} is ${subTopic.state}.${reply}`,
        state: subTopic,
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async readTopic({ limit = 30, topicId }: ReadTopicParams): Promise<BuiltinServerRuntimeOutput> {
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
          lines.length > 0 ? lines.join('\n\n') : `Sub-topic ${topicId} has no messages yet.`,
        state: { count: lines.length, topicId },
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async sendToTopic({ message, topicId }: SendToTopicParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { delivery } = await this.service.send({
        message,
        sourceOperationId: this.context.operationId,
        topicId,
      });
      return {
        content:
          delivery === 'queued'
            ? `Sub-topic ${topicId} is running; the message was queued behind its current turn.`
            : `Sent to sub-topic ${topicId}; it started a new turn.`,
        state: { delivery, topicId },
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async stopTopic({ topicId }: TopicIdParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { stopped } = await this.service.stop(topicId);
      return {
        content:
          stopped > 0 ? `Stopped sub-topic ${topicId}.` : `Sub-topic ${topicId} was not running.`,
        state: { stopped, topicId },
        success: true,
      };
    } catch (error) {
      return fail(error);
    }
  }

  async archiveTopic({ topicId }: TopicIdParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      await this.service.archive(topicId);
      return { content: `Archived sub-topic ${topicId}.`, state: { topicId }, success: true };
    } catch (error) {
      return fail(error);
    }
  }
}
