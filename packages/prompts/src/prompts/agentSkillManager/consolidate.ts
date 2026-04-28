/**
 * Input used by the focused skill consolidation prompt.
 */
export interface AgentSkillConsolidatePromptInput {
  /** Reason the source skills should be consolidated. */
  reason: string;
  /** Overlapping skills that should be reconciled. */
  sourceSkills: Array<{
    content: string;
    id: string;
    metadata: Record<string, unknown>;
    resourceTreeSummary?: string;
  }>;
  /** Optional existing skill to receive the consolidated result. */
  targetSkill?: {
    content: string;
    id: string;
    metadata: Record<string, unknown>;
  };
}

/**
 * System role for consolidating overlapping skills.
 *
 * Use when:
 * - Agent Signal found duplicate or overlapping skills
 * - A maintainer should produce focused file operations for one consolidated skill
 *
 * Expects:
 * - Multiple source skills and an optional target skill
 *
 * Returns:
 * - A strict JSON-only instruction contract for the model
 */
export const AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE = `You are a focused skill consolidation agent.

Consolidate multiple overlapping skills into one better skill package.
Return exactly one minified JSON object and nothing else.

Valid output:
{"operations":[{"name":"updateSkill"|"writeSkillFile"|"removeSkillFile","arguments":{}}],"proposedLifecycleActions":[{"action":"archive"|"promote"|"fork"|"delete","skillRef":"skill-id","reason":"short reason"}],"reason":"short reason","confidence":0.0}

Allowed operation names:
- "updateSkill": replace or update an existing package-relative skill file.
- "writeSkillFile": create or overwrite an additional package-relative skill file.
- "removeSkillFile": remove an obsolete package-relative skill file.

Use proposedLifecycleActions only for human review.
Never apply delete, archive, promote, or fork automatically.
Do not expose broad exploration tools.
Preserve concrete procedures, triggers, pitfalls, and verification steps.
Do not invent unsupported process steps.`;

/**
 * Builds the user prompt for a multi-skill consolidation pass.
 *
 * Use when:
 * - Several skills overlap and should be reconciled
 * - The result will be applied through skill management tools
 *
 * Expects:
 * - Source skills include their current content and metadata
 *
 * Returns:
 * - A compact prompt containing serialized consolidation context
 */
export const createAgentSkillConsolidatePrompt = (input: AgentSkillConsolidatePromptInput) => {
  return `Consolidate these skills.\ninput=${JSON.stringify(input)}`;
};
