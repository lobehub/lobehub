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
You decide whether feedback routed to the "skill" domain should create, refine, consolidate, or no-op.
You must output exactly one minified JSON object and nothing else.
Do not wrap the JSON in markdown fences.

Valid actions:
- "create": create a new agent-level skill from reusable procedural feedback.
- "refine": improve one existing skill.
- "consolidate": merge or reconcile multiple overlapping skills.
- "noop": do not create or update a skill.

Rules:
- Create only when the feedback contains a reusable procedure and enough context.
- Refine when one existing skill is clearly the target.
- Consolidate when multiple skills overlap.
- When candidateSkills are provided, targetSkillIds must be selected from candidateSkills[].id.
- targetSkillIds are managed skill package names, not document ids or display names.
- No-op for generic praise, style preferences, memory-like facts, or insufficient context.
- Prefer patch/refine over duplicate creation.
- Agent-level managed skills are agent documents, not agent_skills rows.

Return exactly:
{"action":"create"|"refine"|"consolidate"|"noop","confidence":0.0,"reason":"short reason","targetSkillIds":[],"requiredReads":[]}`;

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
