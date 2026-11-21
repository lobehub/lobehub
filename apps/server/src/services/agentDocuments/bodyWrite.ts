import type { DocumentWriteSource } from '@lobechat/types';

import type { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';

import type { DocumentService } from '../document';
import { writePageBodyThroughRoom } from '../pageCollab/bodyWriter';

export interface AgentDocumentBodyWriter {
  agentDocumentModel: Pick<AgentDocumentModel, 'update'>;
  db: LobeChatDatabase;
  documentService: Pick<DocumentService, 'trySaveCurrentDocumentHistory'>;
  userId: string;
  workspaceId?: string;
}

interface BodySnapshot {
  content: string;
  editorData: Record<string, any>;
}

/**
 * A document open in a live collaboration room has the room projected over its
 * row, so an agent edit written to the row would be lost; it goes into the
 * room instead, which records the AI version itself. False without a live room.
 */
export const writeSnapshotThroughRoom = (
  writer: AgentDocumentBodyWriter,
  documentId: string,
  snapshot: BodySnapshot,
  writeSource: DocumentWriteSource = 'agent',
) =>
  writePageBodyThroughRoom(
    writer.db,
    documentId,
    { editorData: snapshot.editorData, markdown: snapshot.content },
    { saveSource: 'llm_call', userId: writer.userId, workspaceId: writer.workspaceId, writeSource },
  );

/**
 * Writes an agent's new body for a document: into its live room when it has
 * one, else a pre-edit `llm_call` version (unless the body did not change) and
 * then the row.
 */
export const writeAgentDocumentBody = async (
  writer: AgentDocumentBodyWriter,
  target: { agentDocumentId: string; documentId: string },
  snapshot: BodySnapshot,
  options: {
    /** The pre-edit state, when the stored one is stale (it forced a Markdown recovery). */
    previousEditorData?: Record<string, any>;
    recordHistory?: boolean;
    /**
     * Runs before the row write, only when there is no live room: a room checks
     * the character limit against its own body, which may be ahead of the row.
     */
    beforeRowWrite?: () => Promise<void>;
    /** Who asked for the write, for the room's character-limit check; defaults to `agent`. */
    writeSource?: DocumentWriteSource;
  } = {},
) => {
  if (await writeSnapshotThroughRoom(writer, target.documentId, snapshot, options.writeSource))
    return;
  await options.beforeRowWrite?.();

  if (options.recordHistory !== false) {
    const { documentService } = writer;
    await (options.previousEditorData
      ? documentService.trySaveCurrentDocumentHistory(
          target.documentId,
          'llm_call',
          options.previousEditorData,
        )
      : documentService.trySaveCurrentDocumentHistory(target.documentId, 'llm_call'));
  }
  await writer.agentDocumentModel.update(target.agentDocumentId, {
    content: snapshot.content,
    editorData: snapshot.editorData,
  });
};
