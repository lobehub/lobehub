import { createHash } from 'node:crypto';

/**
 * Persistence boundary for a live collaboration room.
 *
 * The room owns the Y.Doc and supplies an immutable update/state-vector
 * snapshot.  This service deliberately knows neither Drizzle nor the document
 * schema: production wiring injects a read-only Headless Editor exporter and a
 * CAS repository, while tests can use an in-memory implementation.
 */

export interface CollaborationRoomSnapshot {
  /** State vector captured in the same turn as `update`. */
  stateVector: Uint8Array;
  /** Full Yjs update captured before the persistence callback starts. */
  update: Uint8Array;
}

export interface CollaborationRoomPersistenceEvent {
  documentId: string;
  messageIds: string[];
  principal: Record<string, unknown> | null;
  requestIds: string[];
  revision: number;
  roomId: string;
  snapshot: CollaborationRoomSnapshot;
  updateBytes: number;
  updatedAt: number;
}

export interface ReadOnlyHeadlessProjection {
  /** JSON projection suitable for `documents.editorData`. */
  editorData: Record<string, unknown>;
  /** Markdown projection suitable for `documents.content`. */
  markdown: string;
}

export interface ReadOnlyHeadlessExporter {
  exportProjection: (input: {
    documentId: string;
    readOnly: true;
    revision: number;
    roomId: string;
    snapshot: CollaborationRoomSnapshot;
  }) => Promise<ReadOnlyHeadlessProjection>;
}

export interface DocumentPersistenceVersion {
  /** Current documents.updatedAt observed by the repository. */
  documentUpdatedAt?: number;
  revision: number;
  roomId?: string;
  /** Full Yjs snapshot, base64 encoded when the durable ledger has one. */
  snapshotUpdate?: string | null;
  stateVector: string;
  /** Opaque repository version (for example a database row revision). */
  token?: string;
}

export interface DocumentPersistenceRepository {
  compareAndSet: (input: {
    documentId: string;
    expected: DocumentPersistenceVersion;
    history: {
      idempotencyKey: string;
      requestId: string | null;
      saveSource: 'autosave' | 'llm_call';
      source: string;
    };
    /** Additional request-linked histories from one coalesced room snapshot. */
    additionalHistories?: Array<{
      idempotencyKey: string;
      requestId: string | null;
      saveSource: 'autosave' | 'llm_call';
      source: string;
    }>;
    next: ReadOnlyHeadlessProjection & {
      roomId: string;
      revision: number;
      /** Exact immutable Yjs snapshot persisted with the projection. */
      snapshot: CollaborationRoomSnapshot;
      stateVector: string;
    };
  }) => Promise<{
    historyId?: string;
    status: 'conflict' | 'duplicate' | 'persisted';
    version?: DocumentPersistenceVersion;
  }>;
  readVersion: (input: { documentId: string }) => Promise<DocumentPersistenceVersion>;
}

export interface DocumentPersistenceServiceOptions {
  exporter: ReadOnlyHeadlessExporter;
  maxRememberedSnapshots?: number;
  repository: DocumentPersistenceRepository;
  resolveHistory?: (event: CollaborationRoomPersistenceEvent) => {
    requestId: string | null;
    saveSource: 'autosave' | 'llm_call';
    source: string;
  };
  saveSource?: 'autosave' | 'llm_call';
  source?: string;
}

export interface DocumentPersistenceResult {
  historyId?: string;
  persisted: boolean;
  reason: 'cas-conflict' | 'duplicate' | 'persisted';
  revision: number;
  stateVector: string;
}

const toBase64 = (value: Uint8Array) => Buffer.from(value).toString('base64');

const snapshotDigest = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const cloneSnapshot = (snapshot: CollaborationRoomSnapshot): CollaborationRoomSnapshot => ({
  stateVector: new Uint8Array(snapshot.stateVector),
  update: new Uint8Array(snapshot.update),
});

/**
 * Adapter used by the room persistence worker.
 *
 * It coalesces duplicate room snapshots, serializes the same document's
 * writes, and leaves CAS conflicts visible to the caller.  A conflict is not
 * retried against a guessed snapshot: the next room event re-reads the
 * repository version and exports the immutable room state again.
 */
export class DocumentPersistenceService {
  private readonly exporter: ReadOnlyHeadlessExporter;
  private readonly maxRememberedSnapshots: number;
  private readonly repository: DocumentPersistenceRepository;
  private readonly resolveHistory?: DocumentPersistenceServiceOptions['resolveHistory'];
  private readonly saveSource: 'autosave' | 'llm_call';
  private readonly source: string;
  private readonly versions = new Map<string, DocumentPersistenceVersion>();
  private readonly rememberedSnapshots = new Map<string, true>();
  private readonly inFlight = new Map<string, Promise<DocumentPersistenceResult>>();
  private readonly documentQueues = new Map<string, Promise<unknown>>();

  constructor(options: DocumentPersistenceServiceOptions) {
    this.exporter = options.exporter;
    this.maxRememberedSnapshots = Math.max(1, options.maxRememberedSnapshots ?? 10_000);
    this.repository = options.repository;
    this.resolveHistory = options.resolveHistory;
    this.saveSource = options.saveSource ?? 'llm_call';
    this.source = options.source ?? 'agent_collaboration';
  }

  private rememberSnapshot = (snapshotKey: string): void => {
    this.rememberedSnapshots.set(snapshotKey, true);
    while (this.rememberedSnapshots.size > this.maxRememberedSnapshots) {
      const oldest = this.rememberedSnapshots.keys().next().value;
      if (oldest === undefined) break;
      this.rememberedSnapshots.delete(oldest);
    }
  };

  /** Alias suitable for `createCollaborationServer({ onRoomUpdate })`. */
  onRoomUpdate = (event: CollaborationRoomPersistenceEvent) => this.persist(event);

  persist = async (
    event: CollaborationRoomPersistenceEvent,
  ): Promise<DocumentPersistenceResult> => {
    const snapshot = cloneSnapshot(event.snapshot);
    const stateVector = toBase64(snapshot.stateVector);
    // A Yjs delete can change the full update while leaving its state vector
    // unchanged. Include the immutable snapshot digest in the local
    // de-duplication key so a delete-only event cannot be dropped.
    const snapshotKey = `${event.roomId}:${event.revision}:${stateVector}:${snapshotDigest(snapshot.update)}`;
    const remembered = this.rememberedSnapshots.has(snapshotKey);
    if (remembered) {
      return {
        persisted: false,
        reason: 'duplicate',
        revision: event.revision,
        stateVector,
      };
    }

    const currentFlight = this.inFlight.get(snapshotKey);
    if (currentFlight) return currentFlight;

    // Serialize snapshots per document. The room may receive another update
    // while an exporter or repository call is awaiting I/O; ordering those
    // writes makes the expected CAS version deterministic.
    const previous = this.documentQueues.get(event.documentId);
    const operation = (previous?.catch(() => undefined) ?? Promise.resolve()).then(() =>
      this.persistSnapshot(event, snapshot, snapshotKey, stateVector),
    );
    const tracked = operation.finally(() => {
      this.inFlight.delete(snapshotKey);
      if (this.documentQueues.get(event.documentId) === tracked) {
        this.documentQueues.delete(event.documentId);
      }
    });
    this.documentQueues.set(event.documentId, tracked);
    this.inFlight.set(snapshotKey, tracked);
    return tracked;
  };

  private persistSnapshot = async (
    event: CollaborationRoomPersistenceEvent,
    snapshot: CollaborationRoomSnapshot,
    snapshotKey: string,
    stateVector: string,
  ): Promise<DocumentPersistenceResult> => {
    let expected = this.versions.get(event.documentId);
    if (!expected) {
      expected = await this.repository.readVersion({ documentId: event.documentId });
      this.versions.set(event.documentId, expected);
    }

    if (expected.roomId && expected.roomId !== event.roomId) {
      return {
        persisted: false,
        reason: 'cas-conflict',
        revision: event.revision,
        stateVector,
      };
    }
    // A restarted room process may begin its local revision at 1 while the
    // durable ledger already contains this exact full state vector. Treat it
    // as an idempotent replay; do not rotate the DB token or append history.
    const snapshotUpdate = toBase64(snapshot.update);
    if (expected.stateVector === stateVector && expected.snapshotUpdate === snapshotUpdate) {
      this.rememberSnapshot(snapshotKey);
      return {
        persisted: false,
        reason: 'duplicate',
        revision: event.revision,
        stateVector,
      };
    }

    // Keep the bytes sent to the exporter separate from the bytes written to
    // the ledger. A malformed exporter must not be able to mutate the exact
    // room snapshot that the persistence transaction records.
    const projection = await this.exporter.exportProjection({
      documentId: event.documentId,
      readOnly: true,
      revision: event.revision,
      roomId: event.roomId,
      snapshot: cloneSnapshot(snapshot),
    });
    if (!projection || typeof projection.markdown !== 'string' || !projection.editorData) {
      throw new Error('The read-only Headless Editor exporter returned an invalid projection.');
    }

    const resolvedHistory = this.resolveHistory?.(event) ?? {
      requestId: event.requestIds[0] ?? null,
      saveSource: this.saveSource,
      source: this.source,
    };
    const { requestId } = resolvedHistory;
    const historyIdempotencyKey = requestId
      ? `${resolvedHistory.source}:${requestId}`
      : `${resolvedHistory.source}:${snapshotKey}`;
    const additionalHistories = event.requestIds
      .filter(
        (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
      )
      .filter((candidate, index, requestIds) => requestIds.indexOf(candidate) === index)
      .filter((candidate) => candidate !== requestId)
      .map((candidate) => ({
        idempotencyKey: `${resolvedHistory.source}:${candidate}`,
        requestId: candidate,
        saveSource: 'llm_call' as const,
        source: resolvedHistory.source,
      }));
    const result = await this.repository.compareAndSet({
      documentId: event.documentId,
      expected,
      history: {
        idempotencyKey: historyIdempotencyKey,
        requestId,
        saveSource: resolvedHistory.saveSource,
        source: resolvedHistory.source,
      },
      ...(additionalHistories.length > 0 ? { additionalHistories } : {}),
      next: {
        ...projection,
        roomId: event.roomId,
        // A room process can restart with its in-memory revision at 1 while
        // the durable ledger is already at a larger revision. Keep the
        // durable sequence monotonic; the Yjs state vector remains the source
        // of truth for the actual snapshot identity.
        revision: Math.max(event.revision, expected.revision + 1),
        snapshot,
        stateVector,
      },
    });

    if (result.status === 'conflict') {
      this.versions.delete(event.documentId);
      return {
        persisted: false,
        reason: 'cas-conflict',
        revision: event.revision,
        stateVector,
      };
    }

    if (result.version) this.versions.set(event.documentId, result.version);
    this.rememberSnapshot(snapshotKey);

    return {
      historyId: result.historyId,
      persisted: result.status === 'persisted',
      reason: result.status === 'duplicate' ? 'duplicate' : 'persisted',
      revision: event.revision,
      stateVector,
    };
  };
}
