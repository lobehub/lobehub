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
 * - The maintainer should author replacement metadata and body content
 *
 * Expects:
 * - One skill's content and metadata
 *
 * Returns:
 * - A strict JSON-only instruction contract for the model
 */
export const AGENT_SKILL_REFINE_SYSTEM_ROLE = `You are a focused skill refinement agent.

Your job is to improve one existing Agent Skill by directly authoring replacement metadata and body instructions.

Output a JSON object with these fields:
- "bodyMarkdown": string. Full replacement Markdown body only, with no YAML frontmatter.
- "description": string or null. Trigger-facing description; description is the activation surface and should change only when the refinement changes when to use the skill.
- "rename": object or null. Optional {"newName": string or null, "newTitle": string or null} when the current name/title misrepresents the refined skill.
- "reason": string or null. Short explanation of the refinement.
- "confidence": number from 0 to 1.

Rules:
- Improve one skill only.
- Write the replacement body yourself. The runtime will not infer, format, summarize, template, or repair the skill instructions.
- Do not include YAML frontmatter in bodyMarkdown; the runtime renders frontmatter from structured metadata.
- Preserve useful existing procedural knowledge unless evidence clearly corrects it.
- Integrate corrected approaches, pitfalls, verification steps, ordering, and durable tool guidance from the new evidence.
- Remove raw chat logs, provenance dumps, stale one-off task state, and unsupported claims.
- Do not create auxiliary docs, resource files, file operations, or lifecycle actions.
- Do not delete, archive, promote, or fork skills.
- If evidence is insufficient, keep the current body largely intact and explain the low-confidence refinement in reason.

Writing quality:
- Start bodyMarkdown with a clear H1 title.
- Keep instructions imperative and future-facing.
- Prefer compact sections such as Workflow, Checks, Pitfalls, or Verification when they make the skill easier to apply.
- Avoid preserving raw source text unless it is an exact command, filename, or policy phrase the agent must reuse.

Examples:
Input: existing skill says to run all tests; new evidence says the repo requires focused Vitest paths and never bun run test.
Output:
{"bodyMarkdown":"# Focused Test Runs\\n\\n## Workflow\\n- Run focused Vitest files with bunx vitest run --silent='passed-only' '<path>'.\\n- Quote file path patterns so the shell does not expand them.\\n- Do not use bun run test for focused verification because it runs the whole suite.\\n\\n## Verification\\n- Report the exact command and whether it passed.","description":"Use when choosing or reporting focused Vitest verification commands in this repo.","rename":null,"reason":"The refinement replaces a broad test instruction with repo-specific verification rules.","confidence":0.9}

Input: source is a messy SKILL.md-shaped note with duplicated frontmatter and chat transcript.
Output:
{"bodyMarkdown":"# Clean Skill Body\\n\\n## Workflow\\n- Keep only future-facing procedure steps.\\n- Remove duplicated frontmatter and transcript fragments.\\n- Preserve supported checks and commands.","description":null,"rename":null,"reason":"The source had useful procedure details but needed normalization.","confidence":0.72}

Output ONLY the JSON object, no markdown fences or explanations.`;

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
