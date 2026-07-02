import { CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import {
  AGENT_DOCUMENT_INJECTION_POSITIONS,
  type AgentContextDocument,
  type AgentDocumentInjectionPosition,
} from '@lobechat/context-engine';

import type { AgentDocumentContextPayload } from '@/database/models/agentDocuments';

const VALID_DOCUMENT_POSITIONS = new Set<AgentDocumentInjectionPosition>(
  AGENT_DOCUMENT_INJECTION_POSITIONS,
);

export const normalizeAgentDocumentPosition = (
  position: string | null | undefined,
): AgentDocumentInjectionPosition | undefined => {
  if (!position) return undefined;

  return VALID_DOCUMENT_POSITIONS.has(position as AgentDocumentInjectionPosition)
    ? (position as AgentDocumentInjectionPosition)
    : undefined;
};

/**
 * Map a database `AgentDocumentWithRules` row into the `AgentContextDocument`
 * shape consumed by the context-engine providers.
 *
 * Lives in the app layer (not in `@lobechat/database` nor `@lobechat/context-engine`)
 * because it bridges two independent packages — adding a field here propagates
 * to every caller (client SWR fetch, server agent runtime) at once. Two
 * hand-rolled copies of this map previously diverged when `sourceType` was
 * added on the client only, which broke the "hide web crawls from the
 * progressive index" filter on every server-driven chat ().
 */
export const toAgentContextDocument = (doc: AgentDocumentContextPayload): AgentContextDocument => ({
  content: doc.content,
  contentCharCount: doc.contentCharCount ?? doc.content.length,
  description: doc.description ?? undefined,
  filename: doc.filename,
  id: doc.id,
  loadPosition: normalizeAgentDocumentPosition(
    doc.policy?.context?.position || doc.policyLoadPosition,
  ),
  loadRules: doc.loadRules,
  parentId: doc.parentId ?? undefined,
  policyId: doc.templateId,
  policyLoad: doc.policyLoad,
  policyLoadFormat: doc.policy?.context?.policyLoadFormat || doc.policyLoadFormat || undefined,
  sourceType: doc.sourceType ?? undefined,
  title: doc.title,
  updatedAt: doc.updatedAt ?? undefined,
});

/**
 * Map a list of agent document rows into context-engine documents, dropping
 * folder-like rows (plain folders and skill bundles).
 *
 * Folders are structural VFS nodes with no readable body — they carry an
 * empty `content` but inherit `loadRules`/`loadPosition`, so without this
 * filter they slip into the injection candidate pool and either bloat the
 * progressive index with empty "slots" or emit empty `<agent_document>`
 * blocks (). `AgentContextDocument` deliberately has no `fileType`
 * field, so the folder check has to happen here, at the DB→context boundary,
 * where the derived `isFolder` flag is still available.
 *
 * Before dropping them, we harvest the `custom/folder` rows into a
 * `documentId → title` map and stamp each child's `folderTitle` (matched on
 * `parentId`). This is the only layer that sees both id-spaces at once — a
 * child's `parentId` points at the folder's `documentId` (`documents.id`),
 * while the surviving context docs are keyed by their own `agentDocuments.id`
 * — so folder-title resolution has to happen here, not in the injector. The
 * progressive index then folds same-folder siblings into one summary row
 * without ever consuming the folder body's token budget (LOBE-11072).
 */
export const toAgentContextDocuments = (
  docs: AgentDocumentContextPayload[],
): AgentContextDocument[] => {
  const folderTitleById = new Map<string, string>();
  for (const doc of docs) {
    if (doc.fileType === CUSTOM_FOLDER_FILE_TYPE) folderTitleById.set(doc.documentId, doc.title);
  }

  return docs
    .filter((doc) => !doc.isFolder)
    .map((doc) => {
      const mapped = toAgentContextDocument(doc);
      const folderTitle = doc.parentId ? folderTitleById.get(doc.parentId) : undefined;
      return folderTitle ? { ...mapped, folderTitle } : mapped;
    });
};
