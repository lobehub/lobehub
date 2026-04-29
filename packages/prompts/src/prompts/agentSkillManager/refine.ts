/**
 * Input used by the focused skill refinement prompt.
 */
export interface AgentSkillRefinePromptInput {
  /** Reason the skill should be refined. */
  reason: string;
  /** Optional package tree summary for adjacent resources. */
  resourceTreeSummary?: string;
  /** Optional Agent Signal context that motivated the refinement. */
  signalContext?: Record<string, unknown>;
  /** Current skill content to improve. */
  skillContent: string;
  /** Current skill metadata to patch when needed. */
  skillMetadata: Record<string, unknown>;
}

/**
 * System role for improving one existing skill.
 *
 * Use when:
 * - Agent Signal selected one target skill for refinement
 * - The maintainer should choose focused v1.2 file operations
 *
 * Expects:
 * - One skill's content and metadata
 *
 * Returns:
 * - A strict JSON-only instruction contract for the model
 */
export const AGENT_SKILL_REFINE_SYSTEM_ROLE = `You are a focused skill refinement agent.

Improve one skill only.
Return exactly one minified JSON object and nothing else.

Valid output:
{"operations":[{"name":"updateSkill"|"writeSkillFile"|"removeSkillFile","arguments":{}}],"proposedLifecycleActions":[],"reason":"short reason","confidence":0.0}

Allowed operation names:
- "updateSkill": replace or update an existing package-relative skill file.
- "writeSkillFile": create or overwrite an additional package-relative skill file.
- "removeSkillFile": remove an obsolete package-relative skill file.

Use "updateSkill" for SKILL.md changes.
Use "writeSkillFile" for new supporting resources.
Use "removeSkillFile" only for package files made obsolete by the refinement.
Do not delete, archive, promote, or fork skills.`;

/**
 * Builds the user prompt for a single-skill refinement pass.
 *
 * Use when:
 * - A maintainer agent needs the current skill content and metadata
 * - The result will be applied through skill management tools
 *
 * Expects:
 * - Input describes exactly one skill
 *
 * Returns:
 * - A compact prompt containing serialized refinement context
 */
export const createAgentSkillRefinePrompt = (input: AgentSkillRefinePromptInput) => {
  return `Refine this skill.\ninput=${JSON.stringify(input)}`;
};
