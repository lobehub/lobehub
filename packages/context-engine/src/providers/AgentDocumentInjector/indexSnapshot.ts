import type { AgentContextDocument } from './shared';

/**
 * Keeping the `<agent_documents_index>` block byte-stable across turns.
 *
 * The index sits at the very front of the prompt, so any change to it rewrites
 * the provider prompt cache for the whole conversation behind it. Documents do
 * change between turns (the agent creates, edits and deletes them), so instead
 * of rendering the live list, the index renders a snapshot taken once, and
 * what changed since is told to the model as a note on the user message that
 * started the turn:
 *
 *   index (front)  ← snapshot rows only, never rewritten while the cache is warm
 *   user msg #2    ← <agent_documents_changes> created "Plan"
 *   user msg #3    ← <agent_documents_changes> created "Plan", edited "Notes"
 *
 * A note is computed once when its turn starts and is replayed verbatim on
 * later turns, so the tail stays stable too. The snapshot is refreshed (and
 * the notes dropped) only where the cache is cold anyway: the first turn, a
 * gap longer than the cache TTL, or a history compression.
 */

/** One progressive-index row as the snapshot saw it: everything needed to render it again. */
export interface AgentDocumentIndexRow {
  contentCharCount: number;
  filename: string;
  folderTitle?: string;
  id: string;
  loadPosition?: AgentContextDocument['loadPosition'];
  loadRules?: AgentContextDocument['loadRules'];
  parentId?: string | null;
  parentKind?: AgentContextDocument['parentKind'];
  sourceType?: AgentContextDocument['sourceType'];
  title?: string;
  /** ISO timestamp; absent when the document had none. */
  updatedAt?: string;
}

export type AgentDocumentChangeKind = 'created' | 'deleted' | 'edited';

/** How one document differs from its snapshot row, as of the turn the note belongs to. */
export interface AgentDocumentChange {
  /** Current size; absent for a deleted document. */
  contentCharCount?: number;
  folderTitle?: string;
  id: string;
  kind: AgentDocumentChangeKind;
  title: string;
  /** Current ISO timestamp; absent for a deleted document. */
  updatedAt?: string;
}

/** The changes noted on one user message. */
export interface AgentDocumentIndexNote {
  changes: AgentDocumentChange[];
  messageId: string;
}

export interface AgentDocumentIndexSnapshot {
  /**
   * Id of the newest compressed-history message when the snapshot was taken.
   * A compression rewrites the prompt anyway, so a different id refreshes it.
   */
  compressionId?: string;
  /** Change notes in turn order. Each is replayed on its user message. */
  notes: AgentDocumentIndexNote[];
  rows: AgentDocumentIndexRow[];
  /** ISO timestamp of when the rows were taken. */
  takenAt: string;
}

/** Changes keyed by the id of the user message they are attached to. */
export type AgentDocumentChangesByMessage = Record<string, AgentDocumentChange[]>;

const isProgressive = (doc: AgentContextDocument) =>
  (doc.policyLoad ?? 'progressive') === 'progressive';

/** The index hides web-crawled documents behind a hint, so their changes are not noted either. */
const isListed = (doc: { sourceType?: AgentContextDocument['sourceType'] }) =>
  doc.sourceType !== 'web';

const toIsoTimestamp = (at: Date | string | undefined): string | undefined => {
  if (!at) return undefined;
  const date = typeof at === 'string' ? new Date(at) : at;
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const sizeOf = (doc: AgentContextDocument) => doc.contentCharCount ?? doc.content?.length ?? 0;

const titleOf = (doc: { filename?: string; title?: string }) =>
  doc.title || doc.filename || '(untitled)';

const toRow = (doc: AgentContextDocument & { id: string }): AgentDocumentIndexRow => {
  const updatedAt = toIsoTimestamp(doc.updatedAt);
  return {
    contentCharCount: sizeOf(doc),
    filename: doc.filename,
    id: doc.id,
    ...(doc.folderTitle && { folderTitle: doc.folderTitle }),
    ...(doc.loadPosition && { loadPosition: doc.loadPosition }),
    ...(doc.loadRules && { loadRules: doc.loadRules }),
    ...(doc.parentId && { parentId: doc.parentId }),
    ...(doc.parentKind && { parentKind: doc.parentKind }),
    ...(doc.sourceType && { sourceType: doc.sourceType }),
    ...(doc.title && { title: doc.title }),
    ...(updatedAt && { updatedAt }),
  };
};

const indexedDocs = (docs: AgentContextDocument[]) =>
  docs.filter(
    (doc): doc is AgentContextDocument & { id: string } => !!doc.id && isProgressive(doc),
  );

export function takeAgentDocumentIndexSnapshot(
  docs: AgentContextDocument[],
  { compressionId, takenAt }: { compressionId?: string; takenAt: Date },
): AgentDocumentIndexSnapshot {
  return {
    ...(compressionId && { compressionId }),
    notes: [],
    rows: indexedDocs(docs).map(toRow),
    takenAt: takenAt.toISOString(),
  };
}

/**
 * Every listed document that differs from its snapshot row: created since,
 * edited since (size, date, title or folder changed), or deleted since. Cumulative —
 * a note always states the full difference, so a reader that only sees the
 * newest note (older ones truncated away) still has the whole picture.
 */
export function diffAgentDocumentIndex(
  rows: AgentDocumentIndexRow[],
  docs: AgentContextDocument[],
): AgentDocumentChange[] {
  const live = new Map(indexedDocs(docs).map((doc) => [doc.id, doc]));
  const changes: AgentDocumentChange[] = [];

  for (const row of rows) {
    if (!isListed(row)) continue;
    const doc = live.get(row.id);
    if (!doc) {
      changes.push({
        id: row.id,
        kind: 'deleted',
        title: titleOf(row),
        ...(row.folderTitle && { folderTitle: row.folderTitle }),
      });
      continue;
    }
    const current = toRow(doc);
    if (
      current.contentCharCount !== row.contentCharCount ||
      current.updatedAt !== row.updatedAt ||
      titleOf(current) !== titleOf(row) ||
      // A move changes neither the timestamp nor the size, but a folded folder
      // in the index would keep pointing at the old parent.
      (current.parentId ?? null) !== (row.parentId ?? null) ||
      current.folderTitle !== row.folderTitle
    ) {
      changes.push(toChange(current, 'edited'));
    }
  }

  const known = new Set(rows.map((row) => row.id));
  for (const doc of live.values()) {
    if (!known.has(doc.id) && isListed(doc)) changes.push(toChange(toRow(doc), 'created'));
  }

  return changes;
}

const toChange = (
  row: AgentDocumentIndexRow,
  kind: AgentDocumentChangeKind,
): AgentDocumentChange => ({
  contentCharCount: row.contentCharCount,
  id: row.id,
  kind,
  title: titleOf(row),
  ...(row.folderTitle && { folderTitle: row.folderTitle }),
  ...(row.updatedAt && { updatedAt: row.updatedAt }),
});

/**
 * Documents an earlier note reported as created that no longer exist. The
 * snapshot rows never had them, so the row diff alone would leave the model
 * with the old "created" note and no word that they are gone.
 */
const deletedSinceNoted = (
  snapshot: AgentDocumentIndexSnapshot,
  docs: AgentContextDocument[],
): AgentDocumentChange[] => {
  const live = new Set(indexedDocs(docs).map((doc) => doc.id));
  const inRows = new Set(snapshot.rows.map((row) => row.id));
  const deleted = new Map<string, AgentDocumentChange>();
  for (const note of snapshot.notes) {
    for (const change of note.changes) {
      if (change.kind !== 'created' || live.has(change.id) || inRows.has(change.id)) continue;
      deleted.set(change.id, {
        id: change.id,
        kind: 'deleted',
        title: change.title,
        ...(change.folderTitle && { folderTitle: change.folderTitle }),
      });
    }
  }
  return [...deleted.values()];
};

/**
 * Documents an earlier note reported as edited that now match their snapshot
 * row again (renamed back, say). The row diff no longer lists them, so without
 * this the earlier note — which overrides the index — would stay the last word.
 */
const revertedSinceNoted = (
  snapshot: AgentDocumentIndexSnapshot,
  docs: AgentContextDocument[],
  diffed: AgentDocumentChange[],
): AgentDocumentChange[] => {
  const live = new Map(indexedDocs(docs).map((doc) => [doc.id, doc]));
  const inDiff = new Set(diffed.map((change) => change.id));
  const reverted = new Map<string, AgentDocumentChange>();
  for (const note of snapshot.notes) {
    for (const change of note.changes) {
      const doc = live.get(change.id);
      if (change.kind !== 'edited' || !doc || inDiff.has(change.id)) continue;
      reverted.set(change.id, toChange(toRow(doc), 'edited'));
    }
  }
  return [...reverted.values()];
};

const sameChanges = (a: AgentDocumentChange[], b: AgentDocumentChange[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Note on `messageId` how the documents differ from the snapshot, once.
 *
 * - A message that already has a note keeps it (a retried step or a
 *   regenerated reply replays the same note).
 * - No note is added when nothing changed, or when the difference equals the
 *   newest note still in the conversation — that note already says it.
 *
 * @returns the same snapshot object when nothing was added.
 */
export function noteAgentDocumentChanges(
  snapshot: AgentDocumentIndexSnapshot,
  docs: AgentContextDocument[],
  { messageId, presentMessageIds }: { messageId: string; presentMessageIds: Set<string> },
): AgentDocumentIndexSnapshot {
  if (snapshot.notes.some((note) => note.messageId === messageId)) return snapshot;

  const diffed = [
    ...diffAgentDocumentIndex(snapshot.rows, docs),
    ...deletedSinceNoted(snapshot, docs),
  ];
  const changes = [...diffed, ...revertedSinceNoted(snapshot, docs, diffed)];
  if (changes.length === 0) return snapshot;

  const newestPresent = snapshot.notes.findLast((note) => presentMessageIds.has(note.messageId));
  if (newestPresent && sameChanges(newestPresent.changes, changes)) return snapshot;

  return { ...snapshot, notes: [...snapshot.notes, { changes, messageId }] };
}

/**
 * The documents the index renders from: snapshot rows in place of the live
 * progressive documents — a deleted document keeps its row, a newer one has
 * none — and every other live document (`always` content) unchanged.
 */
export function agentDocumentsFromSnapshot(
  docs: AgentContextDocument[],
  snapshot: AgentDocumentIndexSnapshot,
): AgentContextDocument[] {
  const others = docs.filter((doc) => !doc.id || !isProgressive(doc));
  // `createdAt` is left out on purpose: no snapshot row is "new since the last
  // user message", so the index never carries that marker and never drops it.
  const rows = snapshot.rows.map((row): AgentContextDocument => ({
    ...row,
    policyLoad: 'progressive',
  }));
  return [...others, ...rows];
}

export const agentDocumentChangesByMessage = (
  snapshot: AgentDocumentIndexSnapshot,
): AgentDocumentChangesByMessage | undefined =>
  snapshot.notes.length > 0
    ? Object.fromEntries(snapshot.notes.map((note) => [note.messageId, note.changes]))
    : undefined;

const isSnapshot = (value: unknown): value is AgentDocumentIndexSnapshot =>
  !!value &&
  typeof value === 'object' &&
  Array.isArray((value as AgentDocumentIndexSnapshot).rows) &&
  Array.isArray((value as AgentDocumentIndexSnapshot).notes) &&
  typeof (value as AgentDocumentIndexSnapshot).takenAt === 'string';

interface TurnMessage {
  createdAt?: Date | number | string;
  id?: string;
  role: string;
}

const toEpochMs = (value: TurnMessage['createdAt']): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
  }
  return undefined;
};

export interface ResolveAgentDocumentIndexInput {
  /**
   * How long the provider keeps a prompt cache. A turn whose user message came
   * later than this after the previous message starts cold, so the snapshot is
   * refreshed for free. Same test as `StaleToolResultTrimProcessor`.
   */
  cacheTtlMs: number;
  /** Live documents of the agent. */
  docs: AgentContextDocument[];
  /** The conversation the step runs on. */
  messages: TurnMessage[];
  now: Date;
  /** The snapshot this run already pinned (absent on the run's first step). */
  pinned?: unknown;
  /** The snapshot kept for the conversation between runs. */
  stored?: unknown;
  /**
   * The messages the model will actually see, after history truncation. A note
   * only counts as already shown while its message is among them. Defaults to
   * `messages`.
   */
  visibleMessages?: TurnMessage[];
}

export interface ResolvedAgentDocumentIndex {
  /** The run has not pinned this snapshot yet: pin it for its next steps. */
  pin: boolean;
  /** What the index and the change notes render from. */
  snapshot: AgentDocumentIndexSnapshot;
  /** The snapshot differs from the stored one: keep it for the next run. */
  store: boolean;
}

/**
 * Pick the snapshot a step renders from.
 *
 * - Later steps of a run reuse the one the run pinned, so nothing moves mid-run;
 *   documents the run itself creates or edits are seen through tool results.
 * - A run's first step continues the stored snapshot while the cache can
 *   still be warm, noting this turn's difference on its user message.
 * - Otherwise (no stored snapshot, a cold gap, or a new compression — also
 *   mid-run) a fresh snapshot is taken and the old notes go with the old one.
 */
export function resolveAgentDocumentIndex({
  cacheTtlMs,
  docs,
  messages,
  now,
  pinned,
  stored,
  visibleMessages = messages,
}: ResolveAgentDocumentIndexInput): ResolvedAgentDocumentIndex {
  const compressionId = messages.findLast((m) => m.role === 'compressedGroup')?.id;

  if (isSnapshot(pinned) && pinned.compressionId === compressionId) {
    return { pin: false, snapshot: pinned, store: false };
  }

  const lastUserIndex = messages.findLastIndex((m) => m.role === 'user');
  const lastUser = messages[lastUserIndex];
  const triggeredAt = toEpochMs(lastUser?.createdAt);
  const previousAt = toEpochMs(messages[lastUserIndex - 1]?.createdAt);
  const warm =
    triggeredAt !== undefined && previousAt !== undefined && triggeredAt - previousAt <= cacheTtlMs;

  if (
    !pinned &&
    warm &&
    lastUser?.id &&
    isSnapshot(stored) &&
    stored.compressionId === compressionId
  ) {
    const presentMessageIds = new Set(visibleMessages.flatMap((m) => (m.id ? [m.id] : [])));
    const snapshot = noteAgentDocumentChanges(stored, docs, {
      messageId: lastUser.id,
      presentMessageIds,
    });
    return { pin: true, snapshot, store: snapshot !== stored };
  }

  return {
    pin: true,
    snapshot: takeAgentDocumentIndexSnapshot(docs, { compressionId, takenAt: now }),
    store: true,
  };
}

const formatChangeSize = (length: number | undefined): string => {
  if (length === undefined) return '—';
  if (length === 0) return 'empty';
  if (length < 1000) return String(length);
  if (length < 10_000) return `${(length / 1000).toFixed(1)}k`;
  if (length < 1_000_000) return `${Math.round(length / 1000)}k`;
  return `${(length / 1_000_000).toFixed(1)}M`;
};

const CHANGE_LABEL: Record<AgentDocumentChangeKind, string> = {
  created: 'created',
  deleted: 'deleted',
  edited: 'edited',
};

/**
 * Render a note as a fixed-width table, in the same columns as the index:
 *
 *   CHANGE   TITLE         ID          SIZE  UPDATED
 *   created  Launch plan   9c1f…       2.3k  2026-11-14
 *   deleted  Old draft     4be2…       —     —
 */
export function formatAgentDocumentChanges(changes: AgentDocumentChange[]): string {
  const rows = changes.map((change) => ({
    change: CHANGE_LABEL[change.kind],
    id: change.id,
    size: change.kind === 'deleted' ? '—' : formatChangeSize(change.contentCharCount),
    title: change.folderTitle ? `${change.title} (in ${change.folderTitle})` : change.title,
    updated: change.kind === 'deleted' ? '—' : (change.updatedAt?.slice(0, 10) ?? '—'),
  }));

  const width = (header: string, values: string[]) =>
    Math.max(header.length, ...values.map((value) => value.length));
  const changeWidth = width(
    'CHANGE',
    rows.map((r) => r.change),
  );
  const titleWidth = width(
    'TITLE',
    rows.map((r) => r.title),
  );
  const idWidth = width(
    'ID',
    rows.map((r) => r.id),
  );
  const sizeWidth = width(
    'SIZE',
    rows.map((r) => r.size),
  );

  const line = (cells: [string, string, string, string, string]) =>
    [
      cells[0].padEnd(changeWidth),
      cells[1].padEnd(titleWidth),
      cells[2].padEnd(idWidth),
      cells[3].padEnd(sizeWidth),
      cells[4],
    ].join('  ');

  const hasDeleted = changes.some((change) => change.kind === 'deleted');
  const hasEdited = changes.some((change) => change.kind === 'edited');
  return [
    'Agent documents changed since <agent_documents_index> was listed. The index is not refreshed; for these documents this table is current' +
      (hasDeleted ? ', and deleted ones no longer exist — do not read them.' : '.') +
      // gpt-5.4-mini kept answering from a stale earlier read of an edited document
      // until it was told so explicitly (agent-document-index-ab eval).
      (hasEdited
        ? ' Content read earlier from an edited document is outdated; read it again before using it.'
        : ''),
    '',
    line(['CHANGE', 'TITLE', 'ID', 'SIZE', 'UPDATED']),
    ...rows.map((r) => line([r.change, r.title, r.id, r.size, r.updated])),
  ].join('\n');
}
