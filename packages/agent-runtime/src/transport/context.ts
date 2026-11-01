import type { ResolvedToolSet } from '@lobechat/context-engine';

import type { AgentState, CallLLMPayload } from '../types';

/**
 * Inputs for building the final prompt sent to the model.
 *
 * The package passes the runtime-owned payload/state while adapters bind host
 * sources such as knowledge, skills, documents, persona, and topic references.
 */
export interface ContextBuildInput {
  [key: string]: unknown;
  model: string;
  payload: CallLLMPayload;
  provider: string;
  state: AgentState;
}

export interface ContextBuildOutput {
  /** Adapter-native prepared messages; kept in-memory and out of serialized state. */
  messages: unknown[];
  /** Adapter-native model extension parameters consumed by the LLM transport. */
  modelParameters?: unknown;
  preserveThinking?: boolean;
  replayAssistantReasoning: boolean;
  resolvedTools?: ResolvedToolSet;
}

/**
 * Builds the processed message list fed to the model (system role injection,
 * knowledge, skills, history shaping, reference resolution). Server adapter
 * wraps `serverMessagesEngine`; the client adapter wraps its own context build.
 *
 * Heavy outputs MUST stay out of the serialized agent state (Redis 10MB limit)
 * — the adapter routes large payloads to the trace sink, as today.
 */
export interface ContextBuilder {
  build: (input: ContextBuildInput) => Promise<ContextBuildOutput>;
}
