// Re-export all types from @lobechat/agent-templates for backward compatibility

// Runtime values (enums, consts)
// Database-specific types that remain here

import type {
  AgentDocumentPolicy,
  DocumentLoadFormat,
  DocumentLoadPosition as DocumentLoadPositionType,
  DocumentLoadRules,
  PolicyLoad,
} from '@lobechat/agent-templates';

export {
  AgentAccess,
  AutoLoadAccess,
  DocumentLoadFormat,
  DocumentLoadPosition,
  DocumentLoadRule,
  PolicyLoad,
} from '@lobechat/agent-templates';

// Type-only exports (interfaces)
export type { AgentDocumentPolicy, DocumentLoadRules } from '@lobechat/agent-templates';

export type AgentDocumentSourceType = 'file' | 'web' | 'api' | 'topic' | 'agent' | 'agent-signal';
export type AgentDocumentListSourceType = 'all' | 'file' | 'web';

/**
 * UI-facing tab grouping for an agent document. Derived from `fileType` +
 * `sourceType` + `templateId` server-side so the client never has to
 * categorize itself.
 */
export type AgentDocumentCategory = 'skill' | 'document' | 'web';

/**
 * Fields the server computes from the raw row and attaches to every agent
 * document response. Keeps UI predicates out of the frontend.
 */
export interface AgentDocumentDerivedFields {
  category: AgentDocumentCategory;
  /** Folder (`custom/folder`) or skill bundle — anything that can contain children. */
  isFolder: boolean;
  /** Top-level skill folder (`fileType === 'skills/bundle'`). */
  isSkillBundle: boolean;
  /** The `SKILL.md` index document inside a bundle (`fileType === 'skills/index'`). */
  isSkillIndex: boolean;
}

export interface AgentDocument {
  accessPublic: number;
  accessSelf: number;
  accessShared: number;
  agentId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  deletedByAgentId: string | null;
  deletedByUserId: string | null;
  deleteReason: string | null;
  description: string | null;
  documentId: string;
  editorData: Record<string, any> | null;
  filename: string;
  fileType: string;
  id: string;
  metadata: Record<string, any> | null;
  parentId: string | null;
  policy: AgentDocumentPolicy | null;
  policyLoad: PolicyLoad;
  policyLoadFormat: DocumentLoadFormat;
  policyLoadPosition: string;
  policyLoadRule: string;
  source: string | null;
  sourceType: AgentDocumentSourceType;
  templateId: string | null;
  title: string;
  updatedAt: Date;
  userId: string;
}

export interface AgentDocumentWithRules extends AgentDocument, AgentDocumentDerivedFields {
  loadRules: DocumentLoadRules;
}

export interface AgentDocumentListItem extends AgentDocumentDerivedFields {
  description: string | null;
  documentId: string;
  filename: string;
  fileType: string;
  id: string;
  loadPosition: DocumentLoadPositionType | undefined;
  parentId: string | null;
  sourceType: AgentDocumentSourceType;
  templateId: string | null;
  title: string;
  updatedAt: Date;
}

export interface AgentDocumentContextRow extends AgentDocumentDerivedFields {
  content: string;
  contentCharCount?: number;
  description: string | null;
  documentId: string;
  editorData: Record<string, any> | null;
  filename: string;
  fileType: string;
  id: string;
  loadRules: DocumentLoadRules;
  parentId: string | null;
  policy: AgentDocumentPolicy | null;
  policyLoad: PolicyLoad;
  policyLoadFormat: DocumentLoadFormat;
  policyLoadPosition: string;
  policyLoadRule: string;
  sourceType: AgentDocumentSourceType;
  templateId: string | null;
  title: string;
  updatedAt: Date;
}

export interface AgentDocumentContextPayload {
  content: string;
  contentCharCount?: number;
  description: string | null;
  filename: string;
  id: string;
  isFolder: boolean;
  loadRules: DocumentLoadRules;
  policy: AgentDocumentPolicy | null;
  policyLoad: PolicyLoad;
  policyLoadFormat: DocumentLoadFormat;
  policyLoadPosition: string;
  sourceType: AgentDocumentSourceType;
  templateId: string | null;
  title: string;
  updatedAt: Date;
}

export interface ToolUpdateLoadRule {
  keywordMatchMode?: 'all' | 'any';
  keywords?: string[];
  maxDocuments?: number;
  maxTokens?: number;
  mode?: 'always' | 'manual' | 'on-demand' | 'progressive';
  pinnedDocumentIds?: string[];
  policyLoadFormat?: 'file' | 'raw';
  priority?: number;
  regexp?: string;
  rule?: 'always' | 'by-keywords' | 'by-regexp' | 'by-time-range';
  timeRange?: {
    from?: string;
    to?: string;
  };
}
