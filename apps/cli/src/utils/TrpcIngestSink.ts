import type {
  LocalHeterogeneousAgentType,
  LocalRuntimeHeterogeneousAgentType,
} from '@lobechat/heterogeneous-agents';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

import type { TrpcClient } from '../api/client';
import type { IngestAck, IngestSink } from './BatchIngester';

/**
 * `IngestSink` implementation that forwards batches to the server via tRPC
 * (`aiAgent.heteroIngest` / `aiAgent.heteroFinish`).
 *
 * The CLI authenticates using the `LOBEHUB_JWT` env var (operation-scoped JWT
 * injected by the server before spawning the sandbox / desktop process).
 */
const withoutBackgroundTasks = (events: AgentStreamEvent[]) =>
  events.filter((event) => event.type !== 'background_task');

export class TrpcIngestSink implements IngestSink {
  /**
   * Cleared once the server refused a batch for carrying `background_task`
   * events: a server that predates them rejects the whole batch at input
   * validation, so they are dropped for the rest of the run instead.
   */
  private sendBackgroundTasks = true;

  constructor(
    private readonly client: TrpcClient,
    private readonly agentType: LocalHeterogeneousAgentType | LocalRuntimeHeterogeneousAgentType,
    private readonly operationId: string,
    private readonly topicId: string,
    private readonly assistantMessageId?: string,
  ) {}

  async finish(params: Parameters<IngestSink['finish']>[0]): Promise<void> {
    const receipt = {
      agentType: this.agentType,
      assistantMessageId: this.assistantMessageId,
      operationId: this.operationId,
      topicId: this.topicId,
      ...params,
    };
    // A native process may exit while the backend is restarting. Retain this
    // exact terminal receipt until acknowledged; never launch the agent again.
    // Bounded, in-memory retry only: this does not survive killing the wrapper.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.client.aiAgent.heteroFinish.mutate(receipt);
        return;
      } catch (error) {
        const code = (error as { data?: { code?: string } } | null)?.data?.code;
        if (
          attempt >= 6 ||
          (code && !['INTERNAL_SERVER_ERROR', 'TIMEOUT', 'SERVICE_UNAVAILABLE'].includes(code))
        )
          throw error;
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.min(500 * 2 ** attempt, 8000)),
        );
      }
    }
  }

  async ingest(events: AgentStreamEvent[]): Promise<IngestAck> {
    const sendable = this.sendBackgroundTasks ? events : withoutBackgroundTasks(events);
    // Filtering emptied the batch, and an older server refuses an empty one:
    // nothing is left to deliver, so it counts as delivered.
    if (sendable.length === 0 && events.length > 0) return { accepted: true };
    try {
      return await this.send(sendable);
    } catch (error) {
      const code = (error as { data?: { code?: string } } | null)?.data?.code;
      const hasTasks = sendable.some((event) => event.type === 'background_task');
      if (code !== 'BAD_REQUEST' || !hasTasks) throw error;
      this.sendBackgroundTasks = false;
      const rest = withoutBackgroundTasks(sendable);
      return rest.length > 0 ? this.send(rest) : { accepted: true };
    }
  }

  private async send(events: AgentStreamEvent[]): Promise<IngestAck> {
    const ack = (await this.client.aiAgent.heteroIngest.mutate({
      agentType: this.agentType,
      assistantMessageId: this.assistantMessageId,
      events: events as any,
      operationId: this.operationId,
      topicId: this.topicId,
    })) as { accepted?: boolean; reason?: string } | undefined;

    // Servers older than the refusal contract answer `{ ack: true }` with no
    // verdict; only an explicit `false` means the batch was discarded.
    return { accepted: ack?.accepted !== false, reason: ack?.reason };
  }
}
