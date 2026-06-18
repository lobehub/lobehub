import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_SKILL_CATEGORY,
  AGENT_DOCUMENT_WEB_CATEGORY,
  WEB_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';

import {
  AGENT_SKILL_TEMPLATE_ID,
  DOCUMENT_FOLDER_TYPE,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
} from '../../schemas/file';
import type { AgentDocument, AgentDocumentCategory, AgentDocumentDerivedFields } from './types';

type DeriveInput = Pick<AgentDocument, 'fileType' | 'sourceType' | 'templateId'>;

const isManagedSkill = (doc: DeriveInput): boolean =>
  doc.templateId === AGENT_SKILL_TEMPLATE_ID || doc.fileType?.startsWith('skills/');

const deriveCategory = (doc: DeriveInput): AgentDocumentCategory => {
  if (isManagedSkill(doc)) return AGENT_DOCUMENT_SKILL_CATEGORY;
  if (doc.sourceType === WEB_DOCUMENT_SOURCE_TYPE) return AGENT_DOCUMENT_WEB_CATEGORY;
  return AGENT_DOCUMENT_CATEGORY;
};

export const deriveAgentDocumentFields = (doc: DeriveInput): AgentDocumentDerivedFields => {
  const isSkillBundle = doc.fileType === SKILL_BUNDLE_FILE_TYPE;
  const isSkillIndex = doc.fileType === SKILL_INDEX_FILE_TYPE;
  return {
    category: deriveCategory(doc),
    isFolder: doc.fileType === DOCUMENT_FOLDER_TYPE || isSkillBundle,
    isSkillBundle,
    isSkillIndex,
  };
};
