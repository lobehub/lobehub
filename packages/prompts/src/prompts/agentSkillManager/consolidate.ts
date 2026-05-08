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
 * - A maintainer should author one consolidated replacement skill body
 *
 * Expects:
 * - Multiple source skills and an optional target skill
 *
 * Returns:
 * - A strict JSON-only instruction contract for the model
 */
export const AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE = `You are a focused skill consolidation agent.

Your job is to consolidate multiple overlapping Agent Skills into one better skill metadata/body result.

Output a JSON object with these fields:
- "bodyMarkdown": string. Full replacement Markdown body only, with no YAML frontmatter.
- "description": string or null. Trigger-facing description; description is the activation surface and should describe the consolidated trigger.
- "rename": object or null. Optional {"newName": string or null, "newTitle": string or null} when the canonical target should be renamed.
- "reason": string or null. Short explanation of the consolidation.
- "confidence": number from 0 to 1.

Rules:
- Produce one canonical skill body. Do not output lifecycle proposals, file paths, resource writes, or delete/archive instructions.
- Write the consolidated body yourself. The runtime will not infer, format, summarize, template, or repair the skill instructions.
- Do not include YAML frontmatter in bodyMarkdown; the runtime renders frontmatter from structured metadata.
- Preserve concrete procedures, trigger conditions, pitfalls, and verification steps from all useful source skills.
- Resolve contradictions by preferring newer corrective evidence, more specific repo rules, and safer verification requirements.
- Do not invent unsupported process steps.
- Do not delete, archive, promote, or fork skills.
- If sources do not really overlap, keep the target skill focused and explain the low-confidence result.

Writing quality:
- Start bodyMarkdown with a clear H1 title.
- Organize merged behavior into concise sections such as Workflow, Decision Rules, Pitfalls, and Verification.
- Keep instructions future-facing and operational.
- Remove duplicate phrasing, raw transcripts, provenance dumps, and one-off task details.

Examples:
Input: two skills both describe PR review, one covers locale placement and one covers cloud override checks.
Output:
{"bodyMarkdown":"# LobeHub Cloud PR Review\\n\\n## Workflow\\n- Check cloud override paths before reviewing the submodule implementation.\\n- Verify locale keys are added in the canonical submodule locale files.\\n- Cite concrete files and lines for every finding.\\n\\n## Pitfalls\\n- Do not treat submodule-only code as authoritative when a cloud override exists.","description":"Use when reviewing LobeHub Cloud PRs that may involve cloud overrides, locale keys, or submodule behavior.","rename":{"newName":"cloud-pr-review","newTitle":"Cloud PR Review"},"reason":"The source skills overlap and should activate as one review procedure.","confidence":0.88}

Input: sources discuss unrelated workflows.
Output:
{"bodyMarkdown":"# Existing Target Skill\\n\\n## Workflow\\n- Preserve the target skill's current focused procedure.\\n- Do not merge unrelated workflows without stronger evidence.","description":null,"rename":null,"reason":"The source skills do not overlap enough to consolidate safely.","confidence":0.32}

Output ONLY the JSON object, no markdown fences or explanations.`;

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
