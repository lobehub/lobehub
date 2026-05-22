/**
 * DataTransfer MIME type used when dragging a skill chip from the working
 * sidebar into the chat input. A custom (non-`Files`) type so the file-upload
 * drop zone ignores it — it only reacts to `Files`.
 */
export const SKILL_DRAG_MIME = 'application/x-lobe-skill';

/**
 * Identifier prefix for agent-document skill bundles ("智能体 Skills" —
 * `agent_document` rows with `isSkillBundle=true`). Mirrors the unified VFS
 * skill namespace `./lobe/skills/agent/skills/<name>` flattened to a single
 * token, so we can tell these apart from builtin / DB skill names anywhere an
 * identifier travels (SkillEngine meta, `<skill name="…">` tag, activateSkill
 * runtime resolution).
 *
 * The trailing `:` is part of the prefix so the runtime can `startsWith` /
 * `slice` cheaply without re-introducing the separator.
 */
export const AGENT_SKILLS_IDENTIFIER_PREFIX = 'agent-skills:';

export const buildAgentSkillIdentifier = (filename: string): string =>
  `${AGENT_SKILLS_IDENTIFIER_PREFIX}${filename}`;

export const parseAgentSkillIdentifier = (identifier: string): string | undefined =>
  identifier.startsWith(AGENT_SKILLS_IDENTIFIER_PREFIX)
    ? identifier.slice(AGENT_SKILLS_IDENTIFIER_PREFIX.length)
    : undefined;
