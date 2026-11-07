export interface AgentSignalSkillIntentPromptInput {
  /** User feedback message to classify. */
  message: string;
  /** Compact same-turn context serialized by the service layer. */
  serializedContext?: string;
  /** Optional human-readable topic label extracted from context. */
  topicLabel?: string;
}

export const AGENT_SIGNAL_ANALYZE_INTENT_SKILL_INTENT_SYSTEM_ROLE =
  'Classify skill intent for Agent Signal using semantic meaning and structured evidence. Return direct_decision for explicit skill actions, agent documents or tool outcomes marked hintIsSkill=true, or implicit strong future-use procedural learning. When the evidence points to exactly one existing managed skill, classify the action as refine; when it points only to a hinted document or draft without an existing managed skill target, classify the action as create or promote/register. Return accumulate for generic praise or weak approval. Return non_skill for global user preference that does not belong to skill management. Do not author skills.';

const createAgentSignalAnalyzeIntentSkillIntentPrompt = (
  input: AgentSignalSkillIntentPromptInput,
) =>
  JSON.stringify({
    message: input.message,
    serializedContext:
      input.serializedContext && input.serializedContext.length > 1800
        ? `${input.serializedContext.slice(0, 1800)}...`
        : input.serializedContext,
    topicLabel: input.topicLabel,
  });

/**
 * Builds semantic skill-intent classifier messages for Agent Signal feedback.
 *
 * Use when:
 * - Structural rules cannot decide whether feedback should create, refine, or accumulate skill intent
 * - The service layer needs compact, snapshottable classifier input
 *
 * Expects:
 * - `serializedContext` is already bounded and excludes full document bodies
 *
 * Returns:
 * - System and user messages for structured skill-intent classification
 */
export const AGENT_SIGNAL_SKILL_INTENT_PROMPT_VERSION = 'v1';

export const AGENT_SIGNAL_SKILL_INTENT_JSON_SCHEMA = {
  name: 'agent_signal_skill_intent',
  schema: {
    additionalProperties: false,
    properties: {
      actionIntent: {
        enum: ['create', 'refine', 'consolidate', 'maintain', 'noop', null],
        type: ['string', 'null'],
      },
      confidence: { maximum: 1, minimum: 0, type: 'number' },
      explicitness: {
        enum: [
          'explicit_action',
          'implicit_strong_learning',
          'weak_positive',
          'non_skill_preference',
        ],
        type: 'string',
      },
      reason: { type: 'string' },
      route: { enum: ['direct_decision', 'accumulate', 'non_skill'], type: 'string' },
    },
    required: ['actionIntent', 'confidence', 'explicitness', 'reason', 'route'],
    type: 'object' as const,
  },
  strict: true,
};

export const chainAgentSignalSkillIntent = (input: AgentSignalSkillIntentPromptInput) => [
  {
    content: AGENT_SIGNAL_ANALYZE_INTENT_SKILL_INTENT_SYSTEM_ROLE,
    role: 'system' as const,
  },
  {
    content: createAgentSignalAnalyzeIntentSkillIntentPrompt(input),
    role: 'user' as const,
  },
];
