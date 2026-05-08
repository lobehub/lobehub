/**
 * Input used by the skill creation authoring prompt.
 */
export interface AgentSkillCreatePromptInput {
  /** Agent that should own the created skill. */
  agentId: string;
  /** Existing skills that may overlap with the new skill. */
  candidateSkills?: Array<{
    id: string;
    name: string;
    scope: 'agent' | 'builtin' | 'installed';
  }>;
  /** Evidence from source documents, tool outcomes, and nearby turns. */
  evidence: Array<{ cue: string; excerpt: string }>;
  /** Original feedback or instruction that triggered skill creation. */
  feedbackMessage: string;
  /** Optional source agent document id selected by the decision worker. */
  sourceAgentDocumentId?: string;
  /** Optional source document content selected by the decision worker. */
  sourceDocumentContent?: string;
  /** Optional turn summary around the triggering feedback. */
  turnContext?: string;
}

/**
 * System role for authoring a new managed skill.
 *
 * Use when:
 * - Agent Signal decided reusable procedural knowledge should become a new skill
 * - The model must write metadata and body instructions directly
 *
 * Expects:
 * - The paired user prompt provides source evidence and candidate skills
 *
 * Returns:
 * - A JSON object containing skill metadata and Markdown body content
 */
export const AGENT_SKILL_CREATE_SYSTEM_ROLE = `You are the Agent Skill create author.

Your job is to create reusable Agent Skill metadata and body instructions from source evidence.

Output a JSON object with these fields:
- "name": string. A lowercase hyphen skill name using only lowercase letters, numbers, and hyphens. It must be stable enough to live as the skill bundle name.
- "title": string or null. A short human title for display. Use null when the name is already the clearest title.
- "description": string. Trigger-facing description; description is the activation surface that tells a future agent when to activate the skill.
- "bodyMarkdown": string. Markdown body only, with no YAML frontmatter. The body is loaded after activation and should teach the future agent what to do.
- "reason": string or null. Short explanation of why this should become a skill.
- "confidence": number from 0 to 1.

Rules:
- Write the skill yourself. The runtime will not infer, format, summarize, template, or repair the skill instructions.
- Do not include YAML frontmatter in bodyMarkdown; the runtime renders frontmatter from name and description.
- Create only for recurring procedures, corrected approaches, pitfalls, verification steps, durable tool usage, or complex workflows worth reusing.
- Skip one-off task state, raw chat logs, provenance dumps, user mood, personal facts, or feedback that does not teach a future procedure.
- Preserve concrete ordering, commands, checks, constraints, and failure modes when evidence supports them.
- Do not invent unsupported steps, tools, URLs, credentials, or repository facts.
- Prefer concise, future-facing procedural knowledge. The body should say what to do after activation, not why this skill was created.
- Do not create auxiliary docs or resource files. v1 output is one SKILL.md body represented by bodyMarkdown.
- If the source already resembles SKILL.md but is poorly organized, normalize it into a clear skill body instead of preserving the messy shape.

Writing quality:
- Start bodyMarkdown with a clear H1 title.
- Include trigger-relevant procedure sections such as Workflow, Checks, Pitfalls, or Verification only when useful.
- Keep instructions imperative and operational.
- Use bullet lists for steps and checks when order or scanability matters.
- Avoid raw evidence quotes unless an exact command or label is necessary.

Examples:
Input: feedback says future PR reviews should always inspect locale key placement and existing cloud overrides; evidence includes the exact files to check.
Output:
{"name":"cloud-pr-review-checks","title":"Cloud PR Review Checks","description":"Use when reviewing LobeHub Cloud PRs that may touch locale keys, cloud overrides, or submodule behavior.","bodyMarkdown":"# Cloud PR Review Checks\\n\\n## Workflow\\n- Check cloud override paths before judging submodule code.\\n- Verify new locale keys live in the submodule locale defaults and zh-CN preview files.\\n- Confirm PR feedback cites exact files and lines.\\n\\n## Verification\\n- Run the focused tests or explain why they were not run.","reason":"The feedback describes a reusable review procedure with concrete checks.","confidence":0.86}

Input: feedback says thanks, that answer was helpful.
Output:
{"name":"insufficient-skill-evidence","title":null,"description":"Insufficient evidence to activate as a reusable skill.","bodyMarkdown":"# Insufficient Skill Evidence\\n\\nNo reusable procedure should be created from this input.","reason":"The feedback has no durable procedure.","confidence":0.1}

Output ONLY the JSON object, no markdown fences or explanations.`;

/**
 * Builds the user prompt for a new-skill authoring pass.
 *
 * Use when:
 * - A creation worker needs feedback, evidence, and candidate skills
 * - The result will be persisted through document-backed skill management
 *
 * Expects:
 * - Input is filtered to likely reusable procedural knowledge
 *
 * Returns:
 * - A compact prompt containing serialized creation context
 */
export const createAgentSkillCreatePrompt = (input: AgentSkillCreatePromptInput) => {
  return `Create a managed Agent Skill from this evidence.\ninput=${JSON.stringify(input)}`;
};
