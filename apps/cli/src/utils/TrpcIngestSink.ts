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
    private readonly agentType: 'claude-code' | 'codex',
    private readonly operationId: string,
    private readonly topicId: string,
  ) {}

  async finish(params: Parameters<IngestSink['finish']>[0]): Promise<void> {
    await this.client.aiAgent.heteroFinish.mutate({
      agentType: this.agentType,
      operationId: this.operationId,
      topicId: this.topicId,
      ...params,
    });
  }

  async ingest(events: AgentStreamEvent[]): Promise<void> {
    await this.client.aiAgent.heteroIngest.mutate({
      agentType: this.agentType,
      events: events as any,
      operationId: this.operationId,
      topicId: this.topicId,
    });
  }
}
