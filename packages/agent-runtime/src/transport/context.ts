import type { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

/**
 * Inputs for building the final prompt sent to the model.
 *
 * NOTE (scaffolding): only the always-required trio is pinned. The many context
 * sources the server engine consumes (systemRole, knowledge, tool manifests,
 * agentDocuments, persona/onboarding, topic references, capabilities…) are
 * resolved/bound by the adapter and firm when `call_llm` / `compress_context`
 * (Tier C) migrate onto the port.
 */
export interface ContextBuildInput {
  [key: string]: unknown;
  messages: UIChatMessage[];
  model: string;
  provider: string;
}

export interface ContextBuildOutput {
  messages: OpenAIChatMessage[];
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
