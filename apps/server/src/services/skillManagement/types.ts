import type { AgentDocument } from '@/database/models/agentDocuments';

import type { SkillFrontmatter } from './frontmatter';

/**
 * User-provided selector for a managed skill.
 */
export interface SkillTargetInput {
  /** Agent document binding id from `agent_documents.id`; bundle ids and index ids both resolve to the owning bundle. */
  agentDocumentId?: string;
  /** Stable skill bundle name. */
  name?: string;
}

/**
 * Stable reference to a managed skill document.
 */
export interface SkillDocumentRef {
  /** Agent document binding id from `agent_documents.id`. */
  agentDocumentId: string;
  /** Backing document id from `documents.id`. */
  documentId: string;
  /** Backing document filename. */
  filename: string;
  /** Backing document title. */
  title: string;
}

/**
 * List item returned for a managed skill bundle and its index.
 */
export interface SkillSummary {
  /** Parent bundle document reference. */
  bundle: SkillDocumentRef;
  /** Skill description parsed from index frontmatter. */
  description: string;
  /** Child index document reference. */
  index: SkillDocumentRef;
  /** Stable skill bundle name. */
  name: string;
  /** Human-readable skill title. */
  title: string;
}

/**
 * Full managed skill detail including optional index content.
 */
export interface SkillDetail extends SkillSummary {
  /** Raw SKILL.md content when requested by callers. */
  content?: string;
  /** Parsed index frontmatter. */
  frontmatter: SkillFrontmatter;
}

/** Current managed skill target snapshot used by proposal merge preflight checks. */
export interface SkillTargetSnapshot {
  /** Managed skill bundle agent document id. */
  agentDocumentId: string;
  /** Compare-and-set hash of the current SKILL.md content. */
  contentHash?: string;
  /** Managed skill bundle backing document id. */
  documentId?: string;
  /** Whether the target is still managed by the skill-management service. */
  managed: boolean;
  /** Human-readable skill title. */
  targetTitle?: string;
  /** Whether the target can currently be mutated. */
  writable: boolean;
}

/**
 * Input used to list managed skill bundles for an agent.
 */
export interface ListSkillsInput {
  /** Agent id that owns the skill documents. */
  agentId: string;
}

/**
 * Input used to read one managed skill by stable name or binding id.
 */
export interface GetSkillInput extends SkillTargetInput {
  /** Agent id that owns the skill documents. */
  agentId: string;
  /** Include raw SKILL.md content in the response. */
  includeContent?: boolean;
}

/**
 * Input used to create a managed skill bundle and index document.
 */
export interface CreateSkillInput {
  /** Agent id that owns the skill documents. */
  agentId: string;
  /** Markdown body authored by the skill-management agent; must not include YAML frontmatter. */
  bodyMarkdown: string;
  /** Frontmatter description to persist for the skill. */
  description: string;
  /** Stable skill bundle name. */
  name: string;
  /** Existing hinted document binding id from `agent_documents.id` to convert, when present. */
  sourceAgentDocumentId?: string;
  /** Human-readable skill title. */
  title: string;
}

/**
 * Input used to replace the SKILL.md index document of an existing skill.
 */
export interface ReplaceSkillIndexInput extends SkillTargetInput {
  /** Agent id that owns the skill documents. */
  agentId: string;
  /** Replacement Markdown body authored by the skill-management agent; must not include YAML frontmatter. */
  bodyMarkdown: string;
  /** Optional frontmatter description override. */
  description?: string;
  /** Optional reason stored by later history/audit tasks. */
  updateReason?: string;
}

/**
 * Input used to rename a managed skill bundle and synchronize its index metadata.
 */
export interface RenameSkillInput extends SkillTargetInput {
  /** Agent id that owns the skill documents. */
  agentId: string;
  /** New stable bundle name. */
  newName?: string;
  /** New human-readable title. */
  newTitle?: string;
  /** Optional reason stored by later history/audit tasks. */
  updateReason?: string;
}

/**
 * Agent document row shape used by the skill-management service.
 */
export type SkillAgentDocument = AgentDocument;
