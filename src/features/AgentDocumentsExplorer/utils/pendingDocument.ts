import { nanoid } from 'nanoid';

import { type AgentDocumentItem, FOLDER_FILE_TYPE, PENDING_ID_PREFIX } from '../types';

interface MakePendingArgs {
  agentId: string;
  isFolder: boolean;
  parentId: string | null;
  title: string;
}

export const makePendingDocument = ({
  agentId,
  isFolder,
  parentId,
  title,
}: MakePendingArgs): AgentDocumentItem => {
  const id = `${PENDING_ID_PREFIX}${nanoid(10)}`;
  const now = new Date();
  return {
    accessPublic: 0,
    accessSelf: 1,
    accessShared: 0,
    agentId,
    content: '',
    createdAt: now,
    deletedAt: null,
    deletedByAgentId: null,
    deletedByUserId: null,
    deleteReason: null,
    description: null,
    documentId: id,
    editorData: null,
    filename: title,
    fileType: isFolder ? FOLDER_FILE_TYPE : 'custom/document',
    id,
    loadRules: {} as AgentDocumentItem['loadRules'],
    metadata: null,
    parentId,
    policy: null,
    policyLoad: 'always' as AgentDocumentItem['policyLoad'],
    policyLoadFormat: 'raw' as AgentDocumentItem['policyLoadFormat'],
    policyLoadPosition: '',
    policyLoadRule: '',
    source: null,
    sourceType: 'agent',
    templateId: null,
    title,
    updatedAt: now,
    userId: '',
  };
};
