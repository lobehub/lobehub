import type { AgentDocument, AgentDocumentCategory, AgentDocumentDerivedFields } from './types';

const FOLDER_FILE_TYPE = 'custom/folder';
const SKILL_BUNDLE_FILE_TYPE = 'skills/bundle';
const SKILL_INDEX_FILE_TYPE = 'skills/index';
const AGENT_SKILL_TEMPLATE_ID = 'agent-skill';

type DeriveInput = Pick<AgentDocument, 'fileType' | 'sourceType' | 'templateId'>;

const isManagedSkill = (doc: DeriveInput): boolean =>
  doc.templateId === AGENT_SKILL_TEMPLATE_ID || doc.fileType?.startsWith('skills/');

const deriveCategory = (doc: DeriveInput): AgentDocumentCategory => {
  if (isManagedSkill(doc)) return 'skill';
  if (doc.sourceType === 'web') return 'web';
  return 'document';
};

export const deriveAgentDocumentFields = (doc: DeriveInput): AgentDocumentDerivedFields => {
  const isSkillBundle = doc.fileType === SKILL_BUNDLE_FILE_TYPE;
  const isSkillIndex = doc.fileType === SKILL_INDEX_FILE_TYPE;
  return {
    category: deriveCategory(doc),
    isFolder: doc.fileType === FOLDER_FILE_TYPE || isSkillBundle,
    isSkillBundle,
    isSkillIndex,
  };
};
