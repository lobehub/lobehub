import type { FilesConfigItem } from '../user/settings/filesConfig';

export enum KnowledgeBaseTabs {
  Files = 'files',
  Settings = 'Settings',
  Testing = 'testing',
}

export interface KnowledgeBaseItem {
  avatar: string | null;

  createdAt: Date;
  description?: string | null;
  enabled?: boolean;

  id: string;

  isPublic: boolean | null;

  name: string;

  settings: any;
  // different types of knowledge bases need to be distinguished
  type: string | null;
  updatedAt: Date;
  /** Creator's user id — surfaced so the sidebar can gate creator-only actions. */
  userId?: string;
  /** Workspace-scoped visibility: `public` (default) or `private` (creator-only). */
  visibility?: 'private' | 'public';
}

export interface CreateKnowledgeBaseParams {
  avatar?: string;
  description?: string;
  name: string;
  /** Workspace-scoped visibility for a newly created KB. Derived from the current resource-mode. */
  visibility?: 'private' | 'public';
}

export enum KnowledgeType {
  File = 'file',
  KnowledgeBase = 'knowledgeBase',
}

export interface KnowledgeItem {
  avatar?: string | null;
  content?: string;
  description?: string | null;
  enabled?: boolean;
  fileType?: string;
  id: string;
  name: string;
  /** Creator's user id — used by the picker to gate creator-only actions and identify ownership. */
  ownerUserId?: string;
  type: KnowledgeType;
  /** Workspace-scoped visibility of the underlying resource (file or KB). */
  visibility?: 'private' | 'public';
}

export interface SystemEmbeddingConfig {
  embeddingModel: FilesConfigItem;
  queryMode: string;
  rerankerModel: FilesConfigItem;
}
