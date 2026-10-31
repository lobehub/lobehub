import { DOCUMENT_FOLDER_TYPE } from '@lobechat/database/schemas';

import type { AgentDocument } from '@/database/models/agentDocuments';

import { TOOL_RESULTS_DIR_NAME } from '../toolExecution/constants';

/** Collect ids of root `.tool-results` archive folders present in a doc list. */
export const collectArchiveFolderIds = <
  T extends Pick<AgentDocument, 'documentId' | 'parentId' | 'filename' | 'fileType'>,
>(
  docs: T[],
): Set<string> =>
  new Set(
    docs
      .filter(
        (d) =>
          d.filename === TOOL_RESULTS_DIR_NAME &&
          !d.parentId &&
          d.fileType === DOCUMENT_FOLDER_TYPE,
      )
      .map((d) => d.documentId),
  );

/**
 * Hide the auto-created `.tool-results/` archive (root folder + its children)
 * from user-facing document lists. Applied by default everywhere, including
 * `listDocuments` / `listDocumentsForTopic`. The tool runtime that lets agents
 * discover archived entries opts back in via `includeArchivedToolResults`.
 *
 * `archiveFolderIds` lets callers whose list may not contain the folder row
 * supply the ids explicitly — the topic path only sees the archived file
 * (which is topic-associated), never the folder, so it can't be derived from
 * the list alone.
 */
export const excludeArchivedToolResults = <
  T extends Pick<AgentDocument, 'documentId' | 'parentId' | 'filename' | 'fileType'>,
>(
  docs: T[],
  archiveFolderIds: Set<string> = collectArchiveFolderIds(docs),
): T[] => {
  if (archiveFolderIds.size === 0) return docs;
  return docs.filter(
    (d) =>
      !archiveFolderIds.has(d.documentId) && (!d.parentId || !archiveFolderIds.has(d.parentId)),
  );
};
