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
    category: AGENT_DOCUMENT_CATEGORY,
    description: null,
    documentId: id,
    filename: title,
    fileType: isFolder ? CUSTOM_FOLDER_FILE_TYPE : CUSTOM_DOCUMENT_FILE_TYPE,
    id,
    isFolder,
    isSkillBundle: false,
    isSkillIndex: false,
    loadPosition: undefined,
    parentId,
    sourceType: AGENT_DOCUMENT_SOURCE_TYPE,
    templateId: null,
    title,
    updatedAt: now,
  };
};
