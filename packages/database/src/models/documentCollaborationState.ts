import { createHash, randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import {
  documentCollaborationStates,
  documentHistories,
  documentRewriteRequests,
  documents,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export const DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN = 'absent';
export const DOCUMENT_COLLABORATION_SNAPSHOT_MISSING = 'DOCUMENT_COLLABORATION_SNAPSHOT_MISSING';
export const DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH =
  'DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH';
export const DOCUMENT_COLLABORATION_HISTORY_SAVE_SOURCES = ['autosave', 'llm_call'] as const;
export type DocumentCollaborationHistorySaveSource =
  (typeof DOCUMENT_COLLABORATION_HISTORY_SAVE_SOURCES)[number];

export interface DocumentCollaborationVersion {
  documentUpdatedAt: Date;
  /** Timestamp recorded by the collaboration ledger; null before first seed. */
  persistedDocumentUpdatedAt: Date | null;
  roomId?: string;
  roomRevision: number;
  snapshotUpdate: string | null;
  stateVector: string;
  updatedAt: Date;
  versionToken: string;
}

export interface PersistedDocumentCollaborationProjection {
  content: string;
  editorData: Record<string, unknown>;
  roomId: string;
  roomRevision: number;
  /** Full Yjs update, base64 encoded. Optional for legacy unit callers only. */
  snapshotUpdate?: string | null;
  stateVector: string;
}

export interface DocumentCollaborationHistoryInput {
  idempotencyKey: string;
  requestId: string | null;
  saveSource: DocumentCollaborationHistorySaveSource;
  source: string;
}

export interface DocumentCollaborationSnapshotSeed {
  roomId: string;
  roomRevision: number;
  snapshotUpdate: string;
  stateVector: string;
}

export interface DocumentCollaborationSnapshotSeedResult {
  status: 'existing' | 'seeded';
  version: DocumentCollaborationVersion;
}

export interface PersistDocumentCollaborationInput {
  /** Additional request-linked histories from one coalesced room snapshot. */
  additionalHistories?: DocumentCollaborationHistoryInput[];
  documentId: string;
  expected: DocumentCollaborationVersion;
  history: DocumentCollaborationHistoryInput;
  next: PersistedDocumentCollaborationProjection;
}

export type PersistDocumentCollaborationResult =
  | { status: 'conflict' }
  | {
      historyId?: string;
      status: 'duplicate' | 'persisted';
      version: DocumentCollaborationVersion;
    };

const absentVersion = (documentUpdatedAt = new Date(0)): DocumentCollaborationVersion => ({
  documentUpdatedAt,
  persistedDocumentUpdatedAt: null,
  roomRevision: 0,
  snapshotUpdate: null,
  stateVector: '',
  versionToken: DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN,
  updatedAt: new Date(0),
});

const historyIdFor = (documentId: string, idempotencyKey: string): string =>
  `collab_${createHash('sha256')
    .update(`${documentId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 48)}`;

const sameVersion = (
  left: DocumentCollaborationVersion,
  right: DocumentCollaborationVersion,
): boolean =>
  left.roomRevision === right.roomRevision &&
  left.stateVector === right.stateVector &&
  left.versionToken === right.versionToken;

const versionFromState = (state: {
  documentUpdatedAt: Date;
  roomId: string;
  roomRevision: number;
  snapshotUpdate: string | null;
  stateVector: string;
  updatedAt: Date;
  versionToken: string;
}): DocumentCollaborationVersion => ({
  documentUpdatedAt: state.documentUpdatedAt,
  persistedDocumentUpdatedAt: state.documentUpdatedAt,
  roomId: state.roomId,
  roomRevision: state.roomRevision,
  snapshotUpdate: state.snapshotUpdate,
  stateVector: state.stateVector,
  updatedAt: state.updatedAt,
  versionToken: state.versionToken,
});

/**
 * Database adapter for the room persistence worker.
 *
 * The document row is locked before the collaboration ledger is compared and
 * updated. The CAS, document projection, and idempotent history insert all
 * live in one transaction, so a browser autosave cannot win halfway through a
 * room write and leave the ledger pointing at a different projection.
 */
export class DocumentCollaborationStateModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId ?? undefined;
  }

  private documentScope = (documentId: string) =>
    and(
      eq(documents.id, documentId),
      buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
    );

  readVersion = async (documentId: string): Promise<DocumentCollaborationVersion> => {
    const document = await this.db
      .select({ id: documents.id, updatedAt: documents.updatedAt })
      .from(documents)
      .where(this.documentScope(documentId))
      .limit(1);
    if (!document[0]) throw new Error(`Document not found: ${documentId}`);

    const [state] = await this.db
      .select({
        collaborationDocumentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
        roomId: documentCollaborationStates.roomId,
        roomRevision: documentCollaborationStates.roomRevision,
        snapshotUpdate: documentCollaborationStates.snapshotUpdate,
        stateVector: documentCollaborationStates.stateVector,
        versionToken: documentCollaborationStates.versionToken,
        updatedAt: documentCollaborationStates.updatedAt,
      })
      .from(documentCollaborationStates)
      .where(eq(documentCollaborationStates.documentId, documentId))
      .limit(1);

    if (!state) return absentVersion(document[0].updatedAt);
    const { collaborationDocumentUpdatedAt, ...versionState } = state;
    return {
      ...versionState,
      documentUpdatedAt: document[0].updatedAt,
      persistedDocumentUpdatedAt: collaborationDocumentUpdatedAt,
    };
  };

  /**
   * Atomically install the first room snapshot. A concurrent caller never
   * returns its independently generated Yjs bytes: it reads and returns the
   * row that won the document-scoped transaction instead.
   *
   * Existing rows without snapshot bytes are intentionally rejected here.
   * Those rows predate durable CRDT snapshots and require the explicit
   * `seedSnapshot` administrative path below; rebuilding them from JSON during
   * normal relay startup would mint different Yjs client IDs.
   */
  ensureSnapshot = async (input: {
    documentId: string;
    expectedDocumentUpdatedAt: Date;
    seed: DocumentCollaborationSnapshotSeed;
  }): Promise<DocumentCollaborationSnapshotSeedResult> =>
    this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as LobeChatDatabase;
      const [document] = await tx
        .select({
          id: documents.id,
          updatedAt: documents.updatedAt,
          userId: documents.userId,
          workspaceId: documents.workspaceId,
        })
        .from(documents)
        .where(this.documentScope(input.documentId))
        .for('update')
        .limit(1);
      if (!document) throw new Error(`Document not found: ${input.documentId}`);
      if (document.updatedAt.getTime() !== input.expectedDocumentUpdatedAt.getTime()) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: document changed while seeding`,
        );
      }
      if (input.seed.roomId !== input.documentId) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: room/document mismatch`,
        );
      }

      const [state] = await tx
        .select({
          documentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          persistedDocumentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          roomId: documentCollaborationStates.roomId,
          roomRevision: documentCollaborationStates.roomRevision,
          snapshotUpdate: documentCollaborationStates.snapshotUpdate,
          stateVector: documentCollaborationStates.stateVector,
          updatedAt: documentCollaborationStates.updatedAt,
          versionToken: documentCollaborationStates.versionToken,
        })
        .from(documentCollaborationStates)
        .where(eq(documentCollaborationStates.documentId, input.documentId))
        .for('update')
        .limit(1);

      if (state) {
        if (state.documentUpdatedAt.getTime() !== document.updatedAt.getTime()) {
          throw new Error(
            `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: persisted document version changed`,
          );
        }
        if (state.roomId !== input.seed.roomId) {
          throw new Error(
            `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: room binding changed`,
          );
        }
        if (state.snapshotUpdate === null) {
          throw new Error(
            `${DOCUMENT_COLLABORATION_SNAPSHOT_MISSING}: explicit seedSnapshot is required`,
          );
        }
        return { status: 'existing', version: versionFromState(state) };
      }

      const persistedAt = new Date();
      const version: DocumentCollaborationVersion = {
        documentUpdatedAt: document.updatedAt,
        persistedDocumentUpdatedAt: document.updatedAt,
        roomId: input.seed.roomId,
        roomRevision: input.seed.roomRevision,
        snapshotUpdate: input.seed.snapshotUpdate,
        stateVector: input.seed.stateVector,
        updatedAt: persistedAt,
        versionToken: randomUUID(),
      };
      const [inserted] = await tx
        .insert(documentCollaborationStates)
        .values({
          documentId: input.documentId,
          roomId: input.seed.roomId,
          roomRevision: input.seed.roomRevision,
          snapshotUpdate: input.seed.snapshotUpdate,
          stateVector: input.seed.stateVector,
          versionToken: version.versionToken,
          documentUpdatedAt: document.updatedAt,
          updatedAt: persistedAt,
          userId: document.userId,
          workspaceId: document.workspaceId,
        })
        .onConflictDoNothing({ target: documentCollaborationStates.documentId })
        .returning({ documentId: documentCollaborationStates.documentId });
      if (inserted) return { status: 'seeded', version };

      const [winner] = await tx
        .select({
          documentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          roomId: documentCollaborationStates.roomId,
          roomRevision: documentCollaborationStates.roomRevision,
          snapshotUpdate: documentCollaborationStates.snapshotUpdate,
          stateVector: documentCollaborationStates.stateVector,
          updatedAt: documentCollaborationStates.updatedAt,
          versionToken: documentCollaborationStates.versionToken,
        })
        .from(documentCollaborationStates)
        .where(eq(documentCollaborationStates.documentId, input.documentId))
        .for('update')
        .limit(1);
      if (!winner || winner.snapshotUpdate === null) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_MISSING}: concurrent seed did not produce bytes`,
        );
      }
      if (
        winner.documentUpdatedAt.getTime() !== document.updatedAt.getTime() ||
        winner.roomId !== input.seed.roomId
      ) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: concurrent seed version changed`,
        );
      }
      return { status: 'existing', version: versionFromState(winner) };
    });

  /**
   * Explicit administrative seed/reseed operation for legacy rows that have
   * no durable snapshot bytes. It is CAS-bound to both the document timestamp
   * and the collaboration ledger token. Normal relay startup must call
   * `ensureSnapshot`, never this method.
   */
  seedSnapshot = async (input: {
    documentId: string;
    expected: DocumentCollaborationVersion;
    seed: DocumentCollaborationSnapshotSeed;
  }): Promise<DocumentCollaborationSnapshotSeedResult> =>
    this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as LobeChatDatabase;
      const [document] = await tx
        .select({
          id: documents.id,
          updatedAt: documents.updatedAt,
          userId: documents.userId,
          workspaceId: documents.workspaceId,
        })
        .from(documents)
        .where(this.documentScope(input.documentId))
        .for('update')
        .limit(1);
      if (!document) throw new Error(`Document not found: ${input.documentId}`);
      if (document.updatedAt.getTime() !== input.expected.documentUpdatedAt.getTime()) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: document changed before explicit seed`,
        );
      }
      if (input.seed.roomId !== input.documentId) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: room/document mismatch`,
        );
      }

      const [state] = await tx
        .select({
          documentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          persistedDocumentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          roomId: documentCollaborationStates.roomId,
          roomRevision: documentCollaborationStates.roomRevision,
          snapshotUpdate: documentCollaborationStates.snapshotUpdate,
          stateVector: documentCollaborationStates.stateVector,
          updatedAt: documentCollaborationStates.updatedAt,
          versionToken: documentCollaborationStates.versionToken,
        })
        .from(documentCollaborationStates)
        .where(eq(documentCollaborationStates.documentId, input.documentId))
        .for('update')
        .limit(1);
      if (state?.snapshotUpdate !== null && state?.snapshotUpdate !== undefined) {
        if (
          state.documentUpdatedAt.getTime() !== document.updatedAt.getTime() ||
          state.roomId !== input.seed.roomId
        ) {
          throw new Error(
            `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: existing snapshot version changed`,
          );
        }
        return { status: 'existing', version: versionFromState(state) };
      }

      if (
        state &&
        (state.roomId !== input.seed.roomId ||
          !input.expected.persistedDocumentUpdatedAt ||
          state.documentUpdatedAt.getTime() !==
            input.expected.persistedDocumentUpdatedAt.getTime() ||
          !sameVersion(state, input.expected))
      ) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: collaboration ledger changed before explicit seed`,
        );
      }
      const persistedAt = new Date();
      const version: DocumentCollaborationVersion = {
        documentUpdatedAt: document.updatedAt,
        persistedDocumentUpdatedAt: document.updatedAt,
        roomId: input.seed.roomId,
        roomRevision: input.seed.roomRevision,
        snapshotUpdate: input.seed.snapshotUpdate,
        stateVector: input.seed.stateVector,
        updatedAt: persistedAt,
        versionToken: randomUUID(),
      };

      if (state) {
        const [updated] = await tx
          .update(documentCollaborationStates)
          .set({
            roomId: input.seed.roomId,
            roomRevision: input.seed.roomRevision,
            snapshotUpdate: input.seed.snapshotUpdate,
            stateVector: input.seed.stateVector,
            versionToken: version.versionToken,
            documentUpdatedAt: document.updatedAt,
            updatedAt: persistedAt,
          })
          .where(
            and(
              eq(documentCollaborationStates.documentId, input.documentId),
              eq(documentCollaborationStates.roomRevision, input.expected.roomRevision),
              eq(documentCollaborationStates.stateVector, input.expected.stateVector),
              eq(documentCollaborationStates.versionToken, input.expected.versionToken),
            ),
          )
          .returning({ documentId: documentCollaborationStates.documentId });
        if (!updated) {
          throw new Error(
            `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: collaboration ledger changed during explicit seed`,
          );
        }
        return { status: 'seeded', version };
      }

      if (input.expected.versionToken !== DOCUMENT_COLLABORATION_STATE_ABSENT_TOKEN) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_VERSION_MISMATCH}: expected absent collaboration ledger`,
        );
      }
      const [inserted] = await tx
        .insert(documentCollaborationStates)
        .values({
          documentId: input.documentId,
          roomId: input.seed.roomId,
          roomRevision: input.seed.roomRevision,
          snapshotUpdate: input.seed.snapshotUpdate,
          stateVector: input.seed.stateVector,
          versionToken: version.versionToken,
          documentUpdatedAt: document.updatedAt,
          updatedAt: persistedAt,
          userId: document.userId,
          workspaceId: document.workspaceId,
        })
        .onConflictDoNothing({ target: documentCollaborationStates.documentId })
        .returning({ documentId: documentCollaborationStates.documentId });
      if (inserted) return { status: 'seeded', version };

      const [winner] = await tx
        .select({
          documentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          roomId: documentCollaborationStates.roomId,
          roomRevision: documentCollaborationStates.roomRevision,
          snapshotUpdate: documentCollaborationStates.snapshotUpdate,
          stateVector: documentCollaborationStates.stateVector,
          updatedAt: documentCollaborationStates.updatedAt,
          versionToken: documentCollaborationStates.versionToken,
        })
        .from(documentCollaborationStates)
        .where(eq(documentCollaborationStates.documentId, input.documentId))
        .for('update')
        .limit(1);
      if (!winner || winner.snapshotUpdate === null) {
        throw new Error(
          `${DOCUMENT_COLLABORATION_SNAPSHOT_MISSING}: concurrent seed did not produce bytes`,
        );
      }
      return { status: 'existing', version: versionFromState(winner) };
    });

  persist = async (
    input: PersistDocumentCollaborationInput,
  ): Promise<PersistDocumentCollaborationResult> =>
    this.db.transaction(async (transaction) => {
      if (!DOCUMENT_COLLABORATION_HISTORY_SAVE_SOURCES.includes(input.history.saveSource)) {
        throw new Error('Unsupported document collaboration history source');
      }
      const tx = transaction as unknown as LobeChatDatabase;
      const [document] = await tx
        .select({
          id: documents.id,
          updatedAt: documents.updatedAt,
          userId: documents.userId,
          workspaceId: documents.workspaceId,
        })
        .from(documents)
        .where(this.documentScope(input.documentId))
        .for('update')
        .limit(1);
      if (!document) throw new Error(`Document not found: ${input.documentId}`);

      const [state] = await tx
        .select({
          roomId: documentCollaborationStates.roomId,
          roomRevision: documentCollaborationStates.roomRevision,
          snapshotUpdate: documentCollaborationStates.snapshotUpdate,
          stateVector: documentCollaborationStates.stateVector,
          versionToken: documentCollaborationStates.versionToken,
          documentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          persistedDocumentUpdatedAt: documentCollaborationStates.documentUpdatedAt,
          updatedAt: documentCollaborationStates.updatedAt,
        })
        .from(documentCollaborationStates)
        .where(eq(documentCollaborationStates.documentId, input.documentId))
        .for('update')
        .limit(1);
      const current = state ?? absentVersion();

      if (input.next.roomId !== input.documentId) return { status: 'conflict' };
      if (!sameVersion(current, input.expected)) return { status: 'conflict' };
      if (state && state.roomId !== input.next.roomId) return { status: 'conflict' };
      // A browser autosave does not know about the room ledger. Compare the
      // document version captured by readVersion with the current row while
      // holding its lock; never overwrite a newer human edit.
      if (document.updatedAt.getTime() !== input.expected.documentUpdatedAt.getTime()) {
        return { status: 'conflict' };
      }

      const nextSnapshotUpdate = input.next.snapshotUpdate ?? current.snapshotUpdate;
      // A full Yjs update is the identity of the persisted room state. Yjs
      // deletions may leave the state vector unchanged, so state-vector-only
      // de-duplication would silently discard a delete-only snapshot. Exact
      // replay remains idempotent even when a restarted relay uses a lower or
      // different local room revision.
      if (
        current.snapshotUpdate !== null &&
        nextSnapshotUpdate === current.snapshotUpdate &&
        input.next.stateVector === current.stateVector
      ) {
        return { status: 'duplicate', version: current };
      }

      // One room revision may identify only one immutable full snapshot. A
      // same-revision/different-snapshot arrival is a CAS conflict, never a
      // silent replacement of the already accepted state.
      if (state && input.next.roomRevision === current.roomRevision) {
        return { status: 'conflict' };
      }

      if (input.next.roomRevision < current.roomRevision) return { status: 'conflict' };
      if (
        input.next.roomRevision === current.roomRevision &&
        input.next.stateVector === current.stateVector &&
        nextSnapshotUpdate === current.snapshotUpdate
      ) {
        return { status: 'duplicate', version: current };
      }

      const persistedAt = new Date();
      const nextVersion: DocumentCollaborationVersion = {
        documentUpdatedAt: persistedAt,
        persistedDocumentUpdatedAt: persistedAt,
        roomId: input.next.roomId,
        roomRevision: input.next.roomRevision,
        snapshotUpdate: nextSnapshotUpdate ?? null,
        stateVector: input.next.stateVector,
        versionToken: randomUUID(),
        updatedAt: persistedAt,
      };

      if (state) {
        const [updated] = await tx
          .update(documentCollaborationStates)
          .set({
            roomId: input.next.roomId,
            roomRevision: nextVersion.roomRevision,
            snapshotUpdate: nextVersion.snapshotUpdate,
            stateVector: nextVersion.stateVector,
            versionToken: nextVersion.versionToken,
            documentUpdatedAt: nextVersion.documentUpdatedAt,
            updatedAt: nextVersion.updatedAt,
          })
          .where(
            and(
              eq(documentCollaborationStates.documentId, input.documentId),
              eq(documentCollaborationStates.roomRevision, input.expected.roomRevision),
              eq(documentCollaborationStates.stateVector, input.expected.stateVector),
              eq(documentCollaborationStates.versionToken, input.expected.versionToken),
            ),
          )
          .returning({ documentId: documentCollaborationStates.documentId });
        if (!updated) return { status: 'conflict' };
      } else {
        const [inserted] = await tx
          .insert(documentCollaborationStates)
          .values({
            documentId: input.documentId,
            roomId: input.next.roomId,
            roomRevision: nextVersion.roomRevision,
            snapshotUpdate: nextVersion.snapshotUpdate,
            stateVector: nextVersion.stateVector,
            versionToken: nextVersion.versionToken,
            documentUpdatedAt: nextVersion.documentUpdatedAt,
            updatedAt: nextVersion.updatedAt,
            userId: document.userId,
            workspaceId: document.workspaceId,
          })
          .onConflictDoNothing({ target: documentCollaborationStates.documentId })
          .returning({ documentId: documentCollaborationStates.documentId });
        if (!inserted) return { status: 'conflict' };
      }

      await tx
        .update(documents)
        .set({
          content: input.next.content,
          editorData: input.next.editorData,
          totalCharCount: input.next.content.length,
          totalLineCount: input.next.content.split('\n').length,
          updatedAt: persistedAt,
        })
        .where(this.documentScope(input.documentId));

      const histories = [input.history, ...(input.additionalHistories ?? [])];
      let historyId: string | undefined;
      for (const historyInput of histories) {
        const candidateHistoryId = historyIdFor(input.documentId, historyInput.idempotencyKey);
        const [linkedRequest] = historyInput.requestId
          ? await tx
              .select({
                documentId: documentRewriteRequests.documentId,
                requestedByUserId: documentRewriteRequests.requestedByUserId,
                status: documentRewriteRequests.status,
                workspaceId: documentRewriteRequests.workspaceId,
              })
              .from(documentRewriteRequests)
              .where(eq(documentRewriteRequests.id, historyInput.requestId))
              .limit(1)
          : [undefined];
        const requestCanAdvanceHistory = Boolean(
          historyInput.requestId &&
          historyInput.saveSource === 'llm_call' &&
          historyInput.source === 'agent_collaboration' &&
          linkedRequest &&
          linkedRequest.documentId === input.documentId &&
          (document.workspaceId === null
            ? linkedRequest.requestedByUserId === document.userId &&
              linkedRequest.workspaceId === null
            : linkedRequest.workspaceId === document.workspaceId) &&
          [
            'queued',
            'connecting',
            'syncing',
            'thinking',
            'writing',
            'cancel_requested',
            'canceled_after_write',
            'retry_wait',
          ].includes(linkedRequest.status),
        );
        const historyValues = {
          documentId: input.documentId,
          editorData: input.next.editorData,
          id: candidateHistoryId,
          requestId: historyInput.requestId,
          saveSource: historyInput.saveSource,
          savedAt: new Date(),
          source: historyInput.source,
          userId: document.userId,
          workspaceId: document.workspaceId,
        };
        const historyInsert = requestCanAdvanceHistory
          ? tx
              .insert(documentHistories)
              .values(historyValues)
              .onConflictDoUpdate({
                // A request-linked history row is the durable projection used
                // by direct-apply recovery. The first room flush may contain
                // only a partial stream; keep the stable idempotency identity,
                // but advance its editorData until final apply settles the row.
                target: documentHistories.id,
                set: {
                  editorData: input.next.editorData,
                  savedAt: new Date(),
                },
              })
          : tx
              .insert(documentHistories)
              .values(historyValues)
              .onConflictDoNothing({ target: documentHistories.id });
        const [history] = await historyInsert.returning({ id: documentHistories.id });
        if (!historyId) historyId = history?.id ?? candidateHistoryId;
      }

      return {
        historyId,
        status: 'persisted',
        version: nextVersion,
      };
    });
}
