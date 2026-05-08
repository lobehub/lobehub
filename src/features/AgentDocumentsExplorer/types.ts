import type { agentDocumentService } from '@/services/agentDocument';

export type AgentDocumentItem = Awaited<
  ReturnType<typeof agentDocumentService.getDocuments>
>[number];

export const PENDING_ID_PREFIX = 'pending:';

export const isPendingId = (id: string): boolean => id.startsWith(PENDING_ID_PREFIX);

export const FOLDER_FILE_TYPE = 'custom/folder';

export const isFolderItem = (doc: AgentDocumentItem): boolean => doc.fileType === FOLDER_FILE_TYPE;
