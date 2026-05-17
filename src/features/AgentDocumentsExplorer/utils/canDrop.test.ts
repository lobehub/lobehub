import { describe, expect, it } from 'vitest';

import type { ExplorerTreeCanDropCtx, ExplorerTreeNode } from '@/features/ExplorerTree';

import type { AgentDocumentItem } from '../types';
import {
  AGENT_SKILL_TEMPLATE_ID,
  FOLDER_FILE_TYPE,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
} from '../types';
import { canDropDocument } from './canDrop';

const createDocument = (overrides: Partial<AgentDocumentItem>): AgentDocumentItem =>
  ({
    accessPublic: 0,
    accessSelf: 0,
    accessShared: 0,
    agentId: 'agent-1',
    content: '',
    createdAt: new Date('2026-05-09T00:00:00Z'),
    deletedAt: null,
    deletedByAgentId: null,
    deletedByUserId: null,
    deleteReason: null,
    description: null,
    documentId: 'doc-1',
    editorData: null,
    filename: 'document.md',
    fileType: 'custom/document',
    id: 'agent-doc-1',
    loadRules: {},
    metadata: null,
    parentId: null,
    policy: null,
    policyLoad: 'disabled',
    policyLoadFormat: 'raw',
    policyLoadPosition: 'before-first-user',
    policyLoadRule: 'always',
    source: null,
    sourceType: 'file',
    templateId: null,
    title: 'Document',
    updatedAt: new Date('2026-05-09T00:00:00Z'),
    userId: 'user-1',
    ...overrides,
  }) as AgentDocumentItem;

const createNode = (
  id: string,
  data: AgentDocumentItem,
  options?: Pick<ExplorerTreeNode<AgentDocumentItem>, 'isFolder' | 'parentId'>,
): ExplorerTreeNode<AgentDocumentItem> => ({
  data,
  id,
  isFolder: options?.isFolder,
  name: data.title,
  parentId: options?.parentId ?? null,
});

const createContext = (
  sourceNode: ExplorerTreeNode<AgentDocumentItem>,
  targetNode: ExplorerTreeNode<AgentDocumentItem> | null,
): ExplorerTreeCanDropCtx<AgentDocumentItem> => ({
  sourceIds: [sourceNode.id],
  sourceNodes: [sourceNode],
  targetId: targetNode?.id ?? null,
  targetNode,
});

describe('canDropDocument', () => {
  it('allows ordinary documents to move into ordinary folders', () => {
    const source = createNode('doc-row', createDocument({ id: 'doc-row' }));
    const target = createNode(
      'folder-row',
      createDocument({ fileType: FOLDER_FILE_TYPE, id: 'folder-row', title: 'Folder' }),
      { isFolder: true },
    );

    expect(canDropDocument({ ctx: createContext(source, target), parentMap: new Map() })).toBe(
      true,
    );
  });

  it('rejects drops into managed skill bundles', () => {
    const source = createNode('doc-row', createDocument({ id: 'doc-row' }));
    const target = createNode(
      'skill-row',
      createDocument({
        documentId: 'skill-bundle-doc',
        fileType: SKILL_BUNDLE_FILE_TYPE,
        id: 'skill-row',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'Research Skill',
      }),
      { isFolder: true },
    );

    expect(canDropDocument({ ctx: createContext(source, target), parentMap: new Map() })).toBe(
      false,
    );
  });

  it('rejects dragging managed skill nodes', () => {
    const source = createNode(
      'skill-index-row',
      createDocument({
        fileType: SKILL_INDEX_FILE_TYPE,
        id: 'skill-index-row',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'SKILL.md',
      }),
    );
    const target = createNode(
      'folder-row',
      createDocument({ fileType: FOLDER_FILE_TYPE, id: 'folder-row', title: 'Folder' }),
      { isFolder: true },
    );

    expect(canDropDocument({ ctx: createContext(source, target), parentMap: new Map() })).toBe(
      false,
    );
  });
});
