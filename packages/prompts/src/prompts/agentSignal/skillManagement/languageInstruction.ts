export interface AgentSignalSkillLanguageInstructionInput {
  /** Current primary language of an existing skill, when refining or consolidating. */
  existingSkillLanguage?: string;
  /** Authoring mode that controls preservation rules. */
  mode: 'consolidate' | 'create' | 'refine';
  /** User-visible response language from settings. */
  responseLanguage: string;
}

/**
 * Builds the language policy block for Agent Signal skill artifacts.
 *
 * Use when:
 * - Agent Signal asks a model to create, refine, or consolidate persisted skill content
 * - Skill artifact language must be chosen separately from UI response language
 *
 * Expects:
 * - `responseLanguage` comes from user settings
 * - `existingSkillLanguage` is supplied when known for refine/consolidate flows
 *
 * Returns:
 * - Prompt text that explains skill artifact language selection
 */
export const createAgentSignalSkillLanguageInstruction = (
  input: AgentSignalSkillLanguageInstructionInput,
) =>
  [
    'Skill artifact language rules:',
    '- Explicit user language instruction wins.',
    input.existingSkillLanguage
      ? `- Preserve the existing skill primary language: ${input.existingSkillLanguage}.`
      : `- Default to ${input.responseLanguage} when the source evidence does not imply a better artifact language.`,
    '- Writing, academic, PR, marketing, legal, translation, and domain-specific skills should use the target work language, not the UI language.',
    '- English academic writing skill under Chinese UI should keep the reusable writing artifact in English.',
    '- Chinese PR copy skill under English UI should keep the reusable writing artifact in Chinese.',
    '- Mixed-language skills are allowed when useful, such as Chinese instructions with English reusable copy templates.',
    '- User-visible proposal summaries still use responseLanguage; skill name, title, description, and bodyMarkdown follow these artifact-language rules.',
  ].join('\n');
