/**
 * Input used to decide how feedback should affect agent skills.
 */
export interface AgentSkillManagerDecisionPromptInput {
  /** Agent that received the feedback. */
  agentId: string;
  /** Skills that may already satisfy or overlap with the feedback. */
  candidateSkills?: Array<{
    id: string;
    name: string;
    scope: 'agent' | 'builtin' | 'installed';
  }>;
  /** Evidence extracted from feedback and nearby turns. */
  evidence: Array<{ cue: string; excerpt: string }>;
  /** Original user feedback message. */
  feedbackMessage: string;
  /** Message id for same-turn document-outcome inspection. */
  messageId?: string;
  /** Runtime scope key for same-turn procedure inspection. */
  scopeKey?: string;
  /** Optional topic context when feedback happened inside a topic. */
  topicId?: string;
  /** Optional summary of the relevant assistant turn. */
  turnContext?: string;
}

/**
 * System role for the skill-management decision agent.
 *
 * Use when:
 * - Agent Signal routes feedback into the skill domain
 * - A small agent must choose create, refine, consolidate, or noop
 *
 * Expects:
 * - The caller provides feedback context in the paired user prompt
 *
 * Returns:
 * - A strict JSON-only instruction contract for the model
 */
export const AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE = `You are the Agent Signal skill-management decision agent.

You are not chatting with the user.
You decide whether feedback routed to the "skill" domain should create, refine, consolidate, no-op, or reject.
When tools are available, inspect only what you need and call submitDecision with the final JSON.
When tools are not available, output exactly one minified JSON object and nothing else.
Do not wrap the JSON in markdown fences.

Valid actions:
- "create": create a new agent-level skill from reusable procedural feedback.
- "refine": improve one existing skill.
- "consolidate": merge or reconcile multiple overlapping skills.
- "noop": do not create or update a skill.
- "reject": refuse this skill-management action because policy, attribution, or evidence says it must not run.

Rules:
- Create only when the feedback contains a reusable procedure and enough context.
- Refine when one existing skill is clearly the target.
- Consolidate when multiple skills overlap.
- When candidateSkills are provided, targetSkillRefs must be selected from candidateSkills[].id.
- targetSkillRefs are agent document ids for managed skill bundle documents.
- targetSkillRefs are not backing documents.id values, package names, filenames, or display names.
- No-op for generic praise, style preferences, memory-like facts, or insufficient context.
- Reject when the user asked for document-only behavior, forbids skill conversion, or same-turn document evidence makes skill mutation unsafe.
- Use read-only tools to inspect same-turn document outcomes before guessing from document names or content shape.
- Do not infer skill intent from a filename, title, or SKILL.md-shaped content alone.
- Do not author SKILL.md content, YAML frontmatter, or file-operation patches in this decision.
- Prefer patch/refine over duplicate creation.
- Agent-level managed skills are agent documents, not agent_skills rows.

Return exactly:
{"action":"create"|"refine"|"consolidate"|"noop"|"reject","confidence":0.0,"reason":"short reason","targetSkillRefs":[],"requiredReads":[],"documentRefs":[]}

Return only the JSON object.`;

/**
 * Builds the user prompt for the skill-management decision agent.
 *
 * Use when:
 * - Passing normalized feedback context into the decision agent
 * - Preserving candidate skill and evidence fields as JSON
 *
 * Expects:
 * - Input is already filtered to skill-domain feedback
 *
 * Returns:
 * - A compact prompt containing serialized decision context
 */
export const createAgentSkillManagerDecisionPrompt = (
  input: AgentSkillManagerDecisionPromptInput,
) => {
  return `Decide the skill-management action for this feedback.\ninput=${JSON.stringify(input)}`;
};
