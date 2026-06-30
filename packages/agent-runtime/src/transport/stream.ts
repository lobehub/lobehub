import type { AgentEvent } from '../types';

/**
 * Incremental streaming delta pushed to the consumer during a step.
 *
 * NOTE (scaffolding): the exact delta union (text / reasoning / tool-call /
 * grounding / image) is server-defined today (`StreamChunkData`). It is
 * intentionally left open here and will be firmed when the first streaming
 * executor (call_llm, Tier C) migrates onto the port.
 */
export interface StreamChunkInput {
  [key: string]: unknown;
  reasoning?: string;
  stepIndex: number;
  text?: string;
}

/**
 * Egress for live streaming. Server adapter forwards to the Redis stream
 * (`IStreamEventManager`); the client adapter dispatches into the UI store.
 *
 * The runtime emits its native {@link AgentEvent}s — the adapter is responsible
 * for translating them to the wire/UI shape, so the package never depends on a
 * transport-specific event format.
 */
export interface StreamSink {
  publishChunk: (chunk: StreamChunkInput) => Promise<void> | void;
  publishEvent: (event: AgentEvent) => Promise<void> | void;
}
