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
type AgentDocumentSkillBundleFields = Pick<AgentDocumentItem, 'documentId' | 'fileType'>;
type AgentDocumentSkillChildFields = Pick<AgentDocumentItem, 'fileType' | 'parentId'>;

export const isSkillBundleItem = (doc: Pick<AgentDocumentItem, 'fileType'>): boolean =>
  doc.fileType === SKILL_BUNDLE_FILE_TYPE;

export const isSkillIndexItem = (doc: Pick<AgentDocumentItem, 'fileType'>): boolean =>
  doc.fileType === SKILL_INDEX_FILE_TYPE;

export const isManagedSkillItem = (doc: AgentDocumentKindFields): boolean =>
  doc.templateId === AGENT_SKILL_TEMPLATE_ID || !!doc.fileType?.startsWith('skills/');

export const hasSkillIndexChild = (
  documents: AgentDocumentSkillChildFields[],
  bundle: Pick<AgentDocumentItem, 'documentId'>,
): boolean => documents.some((doc) => isSkillIndexItem(doc) && doc.parentId === bundle.documentId);

export const isOrphanSkillBundleItem = (
  doc: AgentDocumentSkillBundleFields,
  documents: AgentDocumentSkillChildFields[],
): boolean => isSkillBundleItem(doc) && !hasSkillIndexChild(documents, doc);

export const isProtectedManagedSkillItem = (
  doc: AgentDocumentKindFields & Pick<AgentDocumentItem, 'documentId'>,
  documents: AgentDocumentSkillChildFields[],
): boolean => isManagedSkillItem(doc) && !isOrphanSkillBundleItem(doc, documents);

export const isFolderItem = (doc: AgentDocumentItem): boolean =>
  doc.fileType === FOLDER_FILE_TYPE || isSkillBundleItem(doc);
