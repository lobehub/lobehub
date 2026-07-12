/**
 * A live transport-layer stream event (distinct from the engine's `AgentEvent`
 * returned in the step result). Mirrors the server `IStreamEventManager`
 * protocol: a `type` discriminator (`step_start` | `step_complete` | `tool_end`
 * | `error` | …) plus a type-specific `data` payload, scoped to a step.
 *
 * NOTE: `type` is left as `string` for now — the full server taxonomy is not
 * yet modeled in the package. It firms (and gains a union) when the client
 * converges onto the same protocol (P6). `operationId` is bound by the adapter,
 * not carried here.
 */
export interface RuntimeStreamEvent {
  data: unknown;
  stepIndex: number;
  type: string;
}

/**
 * Incremental token delta pushed during a step (the other stream channel).
 *
 * The exact delta union remains open until client convergence; server and
 * client adapters may carry text, reasoning, tool-call, grounding, or image
 * fields while sharing the stable step scope.
 */
export interface StreamChunkInput {
  [key: string]: unknown;
  reasoning?: string;
  stepIndex: number;
  text?: string;
}

export interface StreamErrorInput {
  error: unknown;
  phase: string;
  stepIndex: number;
}

/**
 * Egress for live streaming. Server adapter forwards to the Redis stream
 * (`IStreamEventManager`); the client adapter dispatches into the UI store.
 */
export interface StreamSink {
  publishChunk: (chunk: StreamChunkInput) => Promise<void>;
  publishError?: (input: StreamErrorInput) => Promise<void>;
  publishEvent: (event: RuntimeStreamEvent) => Promise<void>;
}
