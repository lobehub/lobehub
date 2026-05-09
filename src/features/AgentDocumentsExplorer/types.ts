import type { agentDocumentService } from '@/services/agentDocument';

export type AgentDocumentItem = Awaited<
  ReturnType<typeof agentDocumentService.getDocuments>
>[number];

export const PENDING_ID_PREFIX = 'pending:';

export const isPendingId = (id: string): boolean => id.startsWith(PENDING_ID_PREFIX);

export const FOLDER_FILE_TYPE = 'custom/folder';
export const SKILL_BUNDLE_FILE_TYPE = 'skills/bundle';
export const SKILL_INDEX_FILE_TYPE = 'skills/index';
export const AGENT_SKILL_TEMPLATE_ID = 'agent-skill';

type AgentDocumentKindFields = Pick<AgentDocumentItem, 'fileType' | 'templateId'>;

export const isSkillBundleItem = (doc: Pick<AgentDocumentItem, 'fileType'>): boolean =>
  doc.fileType === SKILL_BUNDLE_FILE_TYPE;

export const isSkillIndexItem = (doc: Pick<AgentDocumentItem, 'fileType'>): boolean =>
  doc.fileType === SKILL_INDEX_FILE_TYPE;

export const isManagedSkillItem = (doc: AgentDocumentKindFields): boolean =>
  doc.templateId === AGENT_SKILL_TEMPLATE_ID || !!doc.fileType?.startsWith('skills/');

export const isFolderItem = (doc: AgentDocumentItem): boolean =>
  doc.fileType === FOLDER_FILE_TYPE || isSkillBundleItem(doc);
