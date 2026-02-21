import { z } from 'zod';

// ===== Manifest Schema =====

export const skillAuthorSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
});

export const skillManifestSchema = z
  .object({
    author: skillAuthorSchema.optional(),

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
}

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

// ===== Resource Types =====

export interface SkillResourceMeta {
  documentId?: string;
  fileHash: string;
  size: number;
}

export interface SkillResourceTreeNode {
  children?: SkillResourceTreeNode[];
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface SkillResourceContent {
  content: string;
  encoding: 'utf-8' | 'base64';
  fileHash: string;
  fileType: string;
  path: string;
  size: number;
}

// ===== Skill Item (完整结构，用于详情查询) =====

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
  zipFileHash?: string | null;
}

// ===== Skill List Item (精简结构，用于列表查询) =====

export interface SkillListItem {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  manifest: SkillManifest;
  name: string;
  source: SkillSource;
  updatedAt: Date;
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
