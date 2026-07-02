import type { RuntimeStreamEvent, StreamChunkInput, StreamSink } from '@lobechat/agent-runtime';

import { type IStreamEventManager } from '../types';

/**
 * Server {@link StreamSink} adapter — forwards runtime stream events/chunks to
 * the operation's Redis stream. Binds `operationId` so the package executor
 * stays unaware of it.
 */
export class ServerStreamSink implements StreamSink {
  constructor(
    private readonly streamManager: IStreamEventManager,
    private readonly operationId: string,
  ) {}

  async publishChunk(chunk: StreamChunkInput): Promise<void> {
    // `stepIndex` is a positional arg to the manager, not part of the chunk data.
    const { stepIndex, ...data } = chunk;
    await this.streamManager.publishStreamChunk(this.operationId, stepIndex, data as any);
  }

  async publishEvent(event: RuntimeStreamEvent): Promise<void> {
    await this.streamManager.publishStreamEvent(this.operationId, {
      data: event.data,
      stepIndex: event.stepIndex,
      type: event.type,
    } as any);
  }
}
