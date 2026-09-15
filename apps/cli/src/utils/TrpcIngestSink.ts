import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

import type { TrpcClient } from '../api/client';
import type { IngestSink } from './BatchIngester';

/**
 * `IngestSink` implementation that forwards batches to the server via tRPC
 * (`aiAgent.heteroIngest` / `aiAgent.heteroFinish`).
 *
 * The CLI authenticates using the `LOBEHUB_JWT` env var (operation-scoped JWT
 * injected by the server before spawning the sandbox / desktop process).
 */
export class TrpcIngestSink implements IngestSink {
  constructor(
    private readonly client: TrpcClient,
    private readonly agentType: LocalHeterogeneousAgentType,
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

  async ingest(events: AgentStreamEvent[]): Promise<void> {
    await this.client.aiAgent.heteroIngest.mutate({
      agentType: this.agentType,
      assistantMessageId: this.assistantMessageId,
      events: events as any,
      operationId: this.operationId,
      topicId: this.topicId,
    });
  }
}
