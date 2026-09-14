import {
  DocumentCollaborationStateModel,
  type DocumentCollaborationVersion,
  type PersistDocumentCollaborationInput,
} from '@/database/models/documentCollaborationState';
import type { LobeChatDatabase } from '@/database/type';

import type { DocumentPersistenceRepository, DocumentPersistenceVersion } from './persistence';

/**
 * Wires the generic room persistence service to the document collaboration
 * ledger. Authorization remains at this boundary (the model scopes the
 * document query to the injected user/workspace), while the generic adapter
 * stays usable with fakes and non-Postgres stores.
 */
export class DatabaseDocumentPersistenceRepository implements DocumentPersistenceRepository {
  private readonly model: DocumentCollaborationStateModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.model = new DocumentCollaborationStateModel(db, userId, workspaceId);
  }

  readVersion = async ({
    documentId,
  }: {
    documentId: string;
  }): Promise<DocumentPersistenceVersion> => {
    const version = await this.model.readVersion(documentId);
    return {
      documentUpdatedAt: version.documentUpdatedAt.getTime(),
      roomId: version.roomId,
      revision: version.roomRevision,
      snapshotUpdate: version.snapshotUpdate,
      stateVector: version.stateVector,
      token: version.versionToken,
    };
  };

  compareAndSet = async (input: Parameters<DocumentPersistenceRepository['compareAndSet']>[0]) => {
    const expected: DocumentCollaborationVersion = {
      documentUpdatedAt: new Date(input.expected.documentUpdatedAt ?? 0),
      persistedDocumentUpdatedAt: input.expected.documentUpdatedAt
        ? new Date(input.expected.documentUpdatedAt)
        : null,
      updatedAt: new Date(input.expected.documentUpdatedAt ?? 0),
      roomRevision: input.expected.revision,
      snapshotUpdate: input.expected.snapshotUpdate ?? null,
      roomId: input.expected.roomId,
      stateVector: input.expected.stateVector,
      versionToken: input.expected.token ?? 'absent',
    };
    const nextInput: PersistDocumentCollaborationInput = {
      documentId: input.documentId,
      expected,
      history: input.history,
      additionalHistories: input.additionalHistories,
      next: {
        content: input.next.markdown,
        editorData: input.next.editorData,
        roomId: input.next.roomId,
        roomRevision: input.next.revision,
        snapshotUpdate: input.next.snapshot
          ? Buffer.from(input.next.snapshot.update).toString('base64')
          : undefined,
        stateVector: input.next.stateVector,
      },
    };
    const result = await this.model.persist(nextInput);
    if (result.status === 'conflict') return { status: 'conflict' as const };
    return {
      historyId: result.historyId,
      status: result.status,
      version: {
        documentUpdatedAt: result.version.documentUpdatedAt.getTime(),
        roomId: result.version.roomId,
        revision: result.version.roomRevision,
        snapshotUpdate: result.version.snapshotUpdate,
        stateVector: result.version.stateVector,
        token: result.version.versionToken,
      },
    };
  };
}
