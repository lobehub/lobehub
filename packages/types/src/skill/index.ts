import { z } from 'zod';

// ===== Manifest Schema =====

export const skillAuthorSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
});

export const skillManifestSchema = z
  .object({
    // Author can be either a string or an object (for compatibility with market skills)
    author: z.union([z.string(), skillAuthorSchema]).optional(),

    // Required: skill description
    description: z.string().min(1, 'Skill description is required'),

    license: z.string().optional(),

    // Required fields
    name: z.string().min(1, 'Skill name is required'),

    permissions: z.array(z.string()).optional(),

    // Project main repository URL
    // e.g. https://github.com/lobehub/skills
    repository: z.string().url().optional(),

    // Source URL where the skill was imported from
    // e.g. https://github.com/lobehub/skills/tree/main/code-review or https://example.com/skill.md
    sourceUrl: z.string().url().optional(),

    // Optional fields
    version: z.string().optional(),
  })
  .passthrough();

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillAuthor = z.infer<typeof skillAuthorSchema>;

// ===== Builtin Skill =====

export interface BuiltinSkill {
  avatar?: string;
  content: string;
  description: string;
  identifier: string;
  name: string;
  /**
   * Inline resources for builtin skills.
   * Key is the file path (e.g. "kb/README.md").
   * Use `content` field in SkillResourceMeta to inline text content.
   */
  resources?: Record<string, SkillResourceMeta>;
  source: 'builtin';
  /**
   * Optional friendly title for UI display. When unset, the inspector and
   * render layers fall back to `name` (which carries the raw identifier).
   * Agent-document skill bundles (`agent-skills:<filename>`) set this so the
   * activateSkill result shows e.g. "LOBE Annotation Cleanup" instead of
   * the raw `agent-skills:lobe-annotation-cleanup`.
   */
  title?: string;
  /**
   * Declared in the skill's own `SKILL.md` frontmatter and parsed from it, so a
   * copy materialized onto a builder's disk carries the version it was installed
   * at. Lets an installer compare an existing copy against the latest bundle
   * instead of blindly overwriting or blindly skipping.
   */
  version?: string;
}

export type BuiltinSkillManifest = Pick<
  BuiltinSkill,
  'avatar' | 'description' | 'identifier' | 'name' | 'source' | 'title'
>;

// ===== Skill Source =====

export type SkillSource = 'builtin' | 'market' | 'user';

// ===== Parsed Skill =====

export interface ParsedSkill {
  content: string;
  manifest: SkillManifest;
  raw: string;
}

export interface ParsedZipSkill {
  content: string;
  manifest: SkillManifest;
  resources: Map<string, Buffer>;
  /**
   * Repacked skill directory ZIP buffer (only when repackSkillZip=true)
   * Used for GitHub imports to store only the skill directory, not the full repo
   */
  skillZipBuffer?: Buffer;
  zipHash?: string;
}

/** One skill parsed out of an archive that holds several skill folders. */
export interface ParsedBatchSkill extends ParsedZipSkill {
  /**
   * Directory that holds the SKILL.md inside the archive, without a trailing
   * slash. `''` is the archive root.
   */
  path: string;
  /** Every batch skill is repacked on its own so its hash names only its files. */
  skillZipBuffer: Buffer;
  zipHash: string;
}

/** A skill folder in a batch archive that could not be parsed. */
export interface ParsedBatchSkillFailure {
  message: string;
  path: string;
}

export interface ParsedSkillBatch {
  failures: ParsedBatchSkillFailure[];
  skills: ParsedBatchSkill[];
}

/**
 * A single batch import accepts at most this many skill folders. Keep the
 * server-side parser and the upload copy in sync through this constant.
 */
export const MAX_BATCH_IMPORT_SKILLS = 50;

/** The existing skill a candidate collides with by name. */
export interface BatchImportConflict {
  id: string;
  identifier: string;
  name: string;
  source: SkillSource;
  updatedAt: Date;
}

/** One skill folder found in a batch archive, shown before anything is written. */
export interface BatchImportCandidate {
  /** The installed skill with the same name, when one exists. */
  conflict?: BatchImportConflict;
  description?: string;
  /**
   * Path of an earlier skill folder in the same archive that resolves to the
   * same name. Importing both with `overwrite` replaces the earlier one; with
   * the default `skip` the later one is skipped.
   */
  duplicateOf?: string;
  /** Set when the folder has a SKILL.md that could not be parsed. */
  error?: string;
  name: string;
  /** Directory inside the archive; `''` for the root. */
  path: string;
  resourceCount: number;
}

export interface BatchImportPreview {
  candidates: BatchImportCandidate[];
  /** Number of candidates that collide with an installed skill by name. */
  conflictCount: number;
  /** Number of candidates whose SKILL.md could not be parsed. */
  invalidCount: number;
}

export type BatchImportConflictStrategy = 'overwrite' | 'skip';

export interface BatchImportChoice {
  /**
   * What to do when an installed skill already uses this name. Ignored when
   * the candidate is new.
   */
  onConflict: BatchImportConflictStrategy;
  /** Candidate path from {@link BatchImportPreview}. */
  path: string;
}

export interface BatchImportInput {
  /**
   * Skills to import. A candidate missing from this list is skipped, so the
   * caller can send only the rows the user selected.
   */
  skills: BatchImportChoice[];
  zipFileId: string;
}

export type BatchImportItemStatus = SkillImportStatus | 'failed' | 'skipped';

export interface BatchImportItemResult {
  error?: string;
  name: string;
  path: string;
  skillId?: string;
  status: BatchImportItemStatus;
}

export interface BatchImportSummary {
  created: number;
  failed: number;
  skipped: number;
  unchanged: number;
  updated: number;
}

export interface BatchImportResult {
  results: BatchImportItemResult[];
  summary: BatchImportSummary;
}

// ===== Resource Types =====

export interface SkillResourceMeta {
  /**
   * Inline text content for builtin skill resources.
   * When set, the resource is served directly from memory instead of S3.
   */
  content?: string;
  documentId?: string;
  fileHash: string;
  size: number;
}

export interface SkillResourceTreeNode {
  children?: SkillResourceTreeNode[];
  content?: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface SkillResourceContent {
  content: string;
  encoding: 'utf8' | 'base64';
  fileHash: string;
  fileType: string;
  fullPath?: string;
  path: string;
  size: number;
}

// ===== Skill Item (full structure, for detail queries) =====

export interface SkillItem {
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: Record<string, any> | null;
  id: string;
  identifier: string;
  manifest: SkillManifest;
  name: string;
  resources?: Record<string, SkillResourceMeta> | null;
  source: SkillSource;
  updatedAt: Date;
  /** Creator attribution — drives the workspace row-level manage gate. */
  userId?: string | null;
  zipFileHash?: string | null;
}

// ===== Skill List Item (simplified structure, for list queries) =====

export interface SkillListItem {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  manifest: SkillManifest;
  name: string;
  source: SkillSource;
  updatedAt: Date;
  /** Creator attribution — drives the workspace row-level manage gate. */
  userId?: string | null;
  zipFileHash?: string | null;
}

// ===== Service Input Types =====

export interface CreateSkillInput {
  content: string;
  description: string;
  identifier?: string;
  name: string;
}

export interface ImportZipInput {
  zipFileId: string;
}

export interface ImportGitHubInput {
  branch?: string;
  gitUrl: string;
}

export interface ImportUrlInput {
  url: string;
}

export interface UpdateSkillInput {
  content?: string;
  description?: string;
  id: string;
  manifest?: Partial<SkillManifest>;
  name?: string;
}

// ===== Import Result Types =====

export type SkillImportStatus = 'created' | 'updated' | 'unchanged';

export interface SkillImportResult {
  skill: SkillItem;
  status: SkillImportStatus;
}
