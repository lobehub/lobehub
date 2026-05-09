import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { createAdapter } from '../registry';
import type { AgentEventAdapter } from '../types';
import { CodexFileChangeTracker } from './codexFileChangeTracker';
import { JsonlStreamProcessor } from './jsonlProcessor';
import { toStreamEvent } from './streamEvent';

export interface AgentStreamPipelineOptions {
  /** Agent type key (e.g. `claude-code`, `codex`). */
  agentType: string;
  /** Operation id to stamp onto every emitted `AgentStreamEvent`. */
  operationId: string;
}

/**
 * Producer-side pipeline that converts CLI stdout chunks into
 * `AgentStreamEvent` batches. Composes the building blocks the
 * heterogeneous-agent contract requires:
 *
 *   stdout chunk → JsonlStreamProcessor → (codex tracker, if applicable) → adapter → toStreamEvent
 *
 * Both the desktop main process and the future `lh hetero exec` CLI feed
 * stdout into this pipeline so consumers (renderer / server) only ever see a
 * single, unified wire shape. Codex's file-change line-stat enrichment is
 * baked in here so consumers don't need to know it exists.
 */
export class AgentStreamPipeline {
  private readonly processor = new JsonlStreamProcessor();
  private readonly adapter: AgentEventAdapter;
  private readonly operationId: string;
  private readonly codexTracker?: CodexFileChangeTracker;

  constructor(options: AgentStreamPipelineOptions) {
    this.adapter = createAdapter(options.agentType);
    this.operationId = options.operationId;
    this.codexTracker = options.agentType === 'codex' ? new CodexFileChangeTracker() : undefined;
  }

  /** CC/Codex session id extracted by the underlying adapter (`adapter.sessionId`). */
  get sessionId(): string | undefined {
    return this.adapter.sessionId;
  }

  /**
   * Push a stdout chunk through the pipeline. Resolves with the resulting
   * `AgentStreamEvent` batch in arrival order. Async because the codex
   * tracker reads pre-edit file snapshots from disk for diff stats.
   */
  async push(chunk: Buffer | string): Promise<AgentStreamEvent[]> {
    return this.processPayloads(this.processor.push(chunk));
  }

  /**
   * Drain any trailing buffered line + flush adapter-buffered events. Call
   * when the upstream stdout stream emits `end`.
   */
  async flush(): Promise<AgentStreamEvent[]> {
    const trailing = await this.processPayloads(this.processor.flush());
    const flushed = this.adapter.flush().map((event) => toStreamEvent(event, this.operationId));
    return [...trailing, ...flushed];
  }

  private async processPayloads(payloads: unknown[]): Promise<AgentStreamEvent[]> {
    const out: AgentStreamEvent[] = [];

    for (const raw of payloads) {
      const payload = this.codexTracker ? await this.codexTracker.track(raw as any) : raw;
      for (const event of this.adapter.adapt(payload)) {
        out.push(toStreamEvent(event, this.operationId));
      }
    }

    return out;
  }
}
