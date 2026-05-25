import type { AgentState } from '@lobechat/agent-runtime';

/**
 * Tool result kind discriminator.
 *
 * - `read`     : read-only evidence tools (getEvidenceDigest, getManagedSkill, …)
 * - `artifact` : side-effect-free output tools (recordReflectionIdea, recordSelfReviewIdea,
 *                recordSelfFeedbackIntent)
 * - `mutation` : durable resource write tools (writeMemory, createSkillIfAbsent,
 *                replaceSkillContentCAS, createSelfReviewProposal, …)
 *
 * Attach this field to every tool result returned by self-iteration tools so
 * that extractFromFinalState can efficiently partition outcomes without
 * inspecting tool names.
 */
export type ToolResultKind = 'artifact' | 'mutation' | 'read';

export interface ToolResultWithKind {
  /** Tool API name (e.g. 'writeMemory'). */
  apiName?: string;
  /** Parsed tool result data. */
  data: unknown;
  /** Discrimination tag set by the tool implementation. */
  kind: ToolResultKind;
  /** Tool call id this result belongs to. */
  toolCallId?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseContent = (content: unknown): unknown => {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
};

/**
 * Extracts tool results of a specific kind from AgentState finalState.
 *
 * Use when:
 * - Completion policy writers need to reconstruct structured output after an
 *   execAgent run completes (replacing the old side-channel closure accumulators).
 * - Replay / eval tooling needs to inspect idea / intent / write outcomes from
 *   a persisted snapshot without re-running the agent.
 *
 * Expects:
 * - Tool messages in state.messages carry a `pluginState.kind` or a top-level
 *   `kind` field set by the self-iteration tool implementation.
 * - Messages without a `kind` field are silently skipped.
 *
 * Returns:
 * - Array of ToolResultWithKind matching the requested kind, in message order.
 */
export const extractFromFinalState = (
  finalState: AgentState,
  kind: ToolResultKind,
): ToolResultWithKind[] => {
  const results: ToolResultWithKind[] = [];

  for (const message of finalState.messages ?? []) {
    if (!isRecord(message)) continue;
    if (message.role !== 'tool') continue;

    const content = parseContent(message.content);
    const contentRecord = isRecord(content) ? content : undefined;

    const pluginState = isRecord(message.pluginState) ? message.pluginState : undefined;
    const resultKind = contentRecord?.kind ?? pluginState?.kind;

    if (resultKind !== kind) continue;

    results.push({
      apiName: typeof message.apiName === 'string' ? message.apiName : undefined,
      data: contentRecord ?? content,
      kind,
      toolCallId: typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined,
    });
  }

  return results;
};

/**
 * Convenience: extract all mutation outcomes from finalState.
 */
export const extractMutations = (finalState: AgentState) =>
  extractFromFinalState(finalState, 'mutation');

/**
 * Convenience: extract all artifact outcomes (ideas, intents) from finalState.
 */
export const extractArtifacts = (finalState: AgentState) =>
  extractFromFinalState(finalState, 'artifact');
