import type { ChatStreamPayload } from '@lobechat/types';

/**
 * Bump when editing the system prompt or schema below. Plumbed through tracing
 * at the call site so per-call tracing groups runs by prompt iteration.
 */
export const GENERATE_SKILL_META_PROMPT_VERSION = 'v1.0';

export const GENERATE_SKILL_META_SCHEMA_NAME = 'skill_meta';

/**
 * Generate the metadata (name / title / description) for a managed skill from
 * the markdown body of an existing agent document.
 *
 * A skill's `description` is the single most important field: the agent reads
 * it to decide WHEN to load the skill, so it must state what the skill does and
 * the situations that should trigger it — not merely restate the title. The
 * `name` is a stable kebab-case identifier (filesystem-safe); the `title` is a
 * short human-readable label.
 */
export const chainGenerateSkillMeta = (params: {
  /** Markdown body of the source document (frontmatter already stripped). */
  content: string;
  /** Target output language, e.g. `zh-CN`. */
  responseLanguage: string;
}): Partial<ChatStreamPayload> => {
  const systemContent = `You are turning an existing document into a reusable agent skill. Read the document and produce concise metadata for it.

Output a JSON object with these fields:
- "name": string. A stable, filesystem-safe identifier in lowercase kebab-case (lowercase letters, digits, and single hyphens only; no spaces, no leading/trailing hyphen; max 80 chars), e.g. "weekly-report" or "pdf-form-filler". Derive it from the document's purpose, NOT a transliteration of the title. Always ASCII regardless of the document language.
- "title": string. A short, human-readable label (max 60 chars).
- "description": string. One or two sentences describing WHAT the skill does AND WHEN the agent should use it, so the agent can decide whether to load it. Lead with the trigger situation. Do not just repeat the title.

Language:
- Output "title" and "description" in ${params.responseLanguage}.
- "name" must always be ASCII lowercase kebab-case, even when the document is in another language.

Output ONLY the JSON object, no markdown fences or explanations.`;

  return {
    messages: [
      { content: systemContent, role: 'system' },
      { content: `Document:\n${params.content}`, role: 'user' },
    ],
    temperature: 0.2,
  };
};

export const GENERATE_SKILL_META_SCHEMA = {
  name: GENERATE_SKILL_META_SCHEMA_NAME,
  schema: {
    additionalProperties: false,
    properties: {
      description: {
        description: 'One or two sentences: what the skill does and when to use it.',
        type: 'string',
      },
      name: {
        description: 'Lowercase kebab-case identifier (ASCII, max 80 chars).',
        type: 'string',
      },
      title: { description: 'Short human-readable label (max 60 chars).', type: 'string' },
    },
    required: ['name', 'title', 'description'],
    type: 'object' as const,
  },
  strict: true,
};
