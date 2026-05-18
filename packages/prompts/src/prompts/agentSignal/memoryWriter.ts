export interface AgentSignalMemoryWriterLanguageInput {
  /** Language required for persisted memory text. */
  memoryLanguage: string;
}

export interface AgentSignalMemoryWriterPromptInput extends AgentSignalMemoryWriterLanguageInput {
  /** Conflict policy selected by routing, when present. */
  conflictPolicy?: unknown;
  /** Evidence snippets that justify the memory decision. */
  evidence?: unknown[];
  /** Feedback satisfaction hint from the classifier. */
  feedbackHint?: 'not_satisfied' | 'satisfied';
  /** User feedback being evaluated for durable memory. */
  message: string;
  /** Domain-routing reason, when present. */
  reason?: string;
  /** Serialized runtime context from the source event. */
  serializedContext?: string;
  /** Source-level classifier hints, when present. */
  sourceHints?: unknown;
}

const MEMORY_WRITER_SYSTEM_ROLE = `You are the Agent Signal memory writer.

You are not chatting with the user.
Your job is to decide whether the feedback should update durable user memory.

Use only the lobe-user-memory built-in tool when a durable memory write is justified.
Choose the correct memory API based on the feedback:
- addPreferenceMemory for stable future-facing preferences
- addIdentityMemory / updateIdentityMemory / removeIdentityMemory for enduring identity facts or corrections
- addContextMemory for ongoing situations, environments, or projects
- addExperienceMemory for reusable lessons from outcomes or workflows
- addActivityMemory for notable concrete events worth remembering

Do not use memory tools for requests to create, update, refine, merge, consolidate, or store reusable skills, procedures, workflows, playbooks, checklists, agent capabilities, agent prompts, or agent documents.
If the feedback asks for a "reusable skill", "future workflow", "PR review checklist skill", "agent capability", or similar operational artifact, skip memory and leave it to the skill/document management path.
Apply the same boundary to Chinese feedback such as "复用 skill", "可复用流程", "review 流程", "检查清单", "下次参考这个流程", "保留这个流程", or "合并/更新清单".
Do not summarize skill-management requests as preferences.

If the feedback should not become durable memory, do not call any tools and end briefly.
Do not invent your own JSON schema. Use the built-in tool exactly as exposed.`;

/**
 * Builds the system role for Agent Signal durable memory writing.
 *
 * Use when:
 * - Agent Signal routes feedback to the memory action agent
 * - Persisted memory language must be explicit at the prompt boundary
 *
 * Expects:
 * - `memoryLanguage` is resolved by the server boundary or falls back to English
 *
 * Returns:
 * - Model-facing memory writer system instructions
 */
export const createAgentSignalMemoryWriterSystemRole = (
  input: AgentSignalMemoryWriterLanguageInput,
) =>
  [MEMORY_WRITER_SYSTEM_ROLE, `Write durable memory content in ${input.memoryLanguage}.`].join(
    '\n\n',
  );

/**
 * Builds the user prompt for Agent Signal durable memory writing.
 *
 * Use when:
 * - The memory action agent needs feedback plus routing context
 * - Tests need the exact prompt sent to the model
 *
 * Expects:
 * - `message` is already trimmed and non-empty
 *
 * Returns:
 * - Model-facing user prompt with memory language and routing context blocks
 */
export const createAgentSignalMemoryWriterPrompt = (input: AgentSignalMemoryWriterPromptInput) => {
  const feedbackHintBlock = input.feedbackHint
    ? `Feedback satisfaction hint: ${input.feedbackHint}`
    : undefined;
  const domainReasonBlock = input.reason ? `Domain routing reason: ${input.reason}` : undefined;
  const evidenceBlock =
    input.evidence && input.evidence.length > 0
      ? `Domain evidence:\n${JSON.stringify(input.evidence)}`
      : undefined;
  const sourceHintsBlock = input.sourceHints
    ? `Source hints:\n${JSON.stringify(input.sourceHints)}`
    : undefined;
  const conflictPolicyBlock = input.conflictPolicy
    ? `Conflict policy:\n${JSON.stringify(input.conflictPolicy)}`
    : undefined;
  const routingContextBlock = [
    feedbackHintBlock,
    domainReasonBlock,
    evidenceBlock,
    sourceHintsBlock,
    conflictPolicyBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
  const contextBlock = input.serializedContext?.trim()
    ? `\n\nAdditional runtime context:\n${input.serializedContext}`
    : '';
  const hintBlock = routingContextBlock ? `\n\nRouting context:\n${routingContextBlock}` : '';

  return `User feedback to analyze for durable memory:\n${input.message}\n\nMemory language: ${input.memoryLanguage}${hintBlock}${contextBlock}`;
};
