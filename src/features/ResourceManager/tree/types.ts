import type { ExplorerTreeNode } from '@/features/ExplorerTree';

export interface ResourceTreeNode {
  fileType: string;
  id: string;
  isFolder: boolean;
  metadata?: Record<string, any>;
  name: string;
  parentId: string | null;
  slug?: string | null;
  sourceType?: string;
  url: string;
}

export type ResourceTreeLoadStatus = 'idle' | 'loading' | 'revalidating' | 'error';

export interface ResourceTreeSnapshotInput {
  childrenByParentId: Map<string | null, ResourceTreeNode[]>;
  expandedIds: Set<string>;
}

export type ResourceExplorerTreeNode = ExplorerTreeNode<ResourceTreeNode>;
