import type {
  AgentDocumentPolicy,
  AgentDocumentSourceType,
  DocumentLoadPosition,
  DocumentLoadRules,
  PolicyLoad,
} from '../types';

export interface AgentDocumentQueryOptions {
  cursor?: string;
  deletedOnly?: boolean;
  includeDeleted?: boolean;
  limit?: number;
}

export interface AgentDocumentCreateParams {
  createdAt?: Date;
  editorData?: Record<string, any>;
  fileId?: string;
  fileType?: string;
  loadPosition?: DocumentLoadPosition;
  loadRules?: DocumentLoadRules;
  metadata?: Record<string, any>;
  parentId?: string | null;
  policy?: AgentDocumentPolicy;
  policyLoad?: PolicyLoad;
  source?: string;
  sourceType?: AgentDocumentSourceType;
  templateId?: string;
  title?: string;
  updatedAt?: Date;
}

export interface AgentDocumentUpdateParams {
  content?: string;
  editorData?: Record<string, any> | null;
  fileType?: string;
  loadPosition?: DocumentLoadPosition;
  loadRules?: Partial<DocumentLoadRules>;
  metadata?: Record<string, any>;
  policy?: AgentDocumentPolicy;
  policyLoad?: PolicyLoad;
}

export interface ConvertAgentDocumentToSkillIndexParams {
  agentDocumentId: string;
  content: string;
  editorData?: Record<string, unknown>;
  filename: string;
  metadata: Record<string, unknown>;
  parentId: string;
  source: string;
  sourceType: AgentDocumentSourceType;
  title: string;
}

export interface AgentDocumentListQueryRow {
  createdAt: Date;
  description: string | null;
  documentId: string;
  documentUpdatedAt: Date;
  fileId: string | null;
  filename: string | null;
  fileType: string;
  id: string;
  parentId: string | null;
  policy: unknown;
  sourceType: AgentDocumentSourceType;
  templateId: string | null;
  title: string | null;
  updatedAt: Date;
}
