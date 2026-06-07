import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_SOURCE_TYPE,
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
} from '@lobechat/const';
import { nanoid } from 'nanoid';

import { type AgentDocumentItem, PENDING_ID_PREFIX } from '../types';

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
    category: AGENT_DOCUMENT_CATEGORY,
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
    fileType: isFolder ? CUSTOM_FOLDER_FILE_TYPE : CUSTOM_DOCUMENT_FILE_TYPE,
    id,
    isFolder,
    isSkillBundle: false,
    isSkillIndex: false,
    loadRules: {} as AgentDocumentItem['loadRules'],
    metadata: null,
    parentId,
    policy: null,
    policyLoad: 'always' as AgentDocumentItem['policyLoad'],
    policyLoadFormat: 'raw' as AgentDocumentItem['policyLoadFormat'],
    policyLoadPosition: '',
    policyLoadRule: '',
    source: null,
    sourceType: AGENT_DOCUMENT_SOURCE_TYPE,
    templateId: null,
    title,
    updatedAt: now,
    userId: '',
  };
};
