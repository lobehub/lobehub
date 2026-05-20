/** Stable identifier for the system-only skill maintainer builtin tool. */
export const SkillMaintainerIdentifier = 'lobe-skill-maintainer';

/** API names exposed by the system-only skill maintainer builtin tool. */
export const SkillMaintainerApiName = {
  createSkill: 'createSkill',
  getSkill: 'getSkill',
  listSkills: 'listSkills',
  renameSkill: 'renameSkill',
  replaceSkillIndex: 'replaceSkillIndex',
} as const;

/** Common selector for a managed skill bundle. */
export interface SkillTargetArgs {
  /** Agent document binding id from `agent_documents.id`. */
  agentDocumentId?: string;
  /** Stable bundle filename. */
  name?: string;
}

/** Args for listing managed skills. */
export interface ListSkillsArgs {}

/** Args for reading one managed skill. */
export interface GetSkillArgs extends SkillTargetArgs {
  /** Include raw `SKILL.md` content in the result. */
  includeContent?: boolean;
}

/** Args for creating a managed skill. */
export interface CreateSkillArgs {
  /** Markdown body only; YAML frontmatter is rendered from structured fields. */
  bodyMarkdown: string;
  /** Canonical skill description. */
  description: string;
  /** Stable bundle filename. */
  name: string;
  /** Existing hinted agent document binding id to convert into the index. */
  sourceAgentDocumentId?: string;
  /** Human-readable bundle title. */
  title: string;
}

/** Args for replacing the managed skill index document. */
export interface ReplaceSkillIndexArgs extends SkillTargetArgs {
  /** Replacement Markdown body only; YAML frontmatter is rendered from structured fields. */
  bodyMarkdown: string;
  /** Optional canonical description override. */
  description?: string;
  /** Reason for later audit/history surfaces. */
  reason?: string;
}

/** Args for renaming a managed skill bundle. */
export interface RenameSkillArgs extends SkillTargetArgs {
  /** New stable bundle filename. */
  newName?: string;
  /** New human-readable bundle title. */
  newTitle?: string;
  /** Reason for later audit/history surfaces. */
  reason?: string;
}
