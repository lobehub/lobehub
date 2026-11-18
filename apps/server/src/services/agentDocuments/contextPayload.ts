import type {
  AgentDocumentContextPayload,
  AgentDocumentContextRow,
} from '@/database/models/agentDocuments';

/** The fields of a context row the agent runtime injects. */
export const toAgentDocumentContextPayload = (
  doc: AgentDocumentContextRow,
): AgentDocumentContextPayload => ({
  content: doc.content,
  contentCharCount: doc.contentCharCount,
  createdAt: doc.createdAt,
  description: doc.description,
  documentId: doc.documentId,
  filename: doc.filename,
  fileType: doc.fileType,
  id: doc.id,
  isFolder: doc.isFolder,
  loadRules: doc.loadRules,
  parentId: doc.parentId,
  policy: doc.policy,
  policyLoad: doc.policyLoad,
  policyLoadFormat: doc.policyLoadFormat,
  policyLoadPosition: doc.policyLoadPosition,
  sourceType: doc.sourceType,
  templateId: doc.templateId,
  title: doc.title,
  updatedAt: doc.updatedAt,
});
