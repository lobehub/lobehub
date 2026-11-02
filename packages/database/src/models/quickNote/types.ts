import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteDelegatePreset,
  QuickNoteProposalKind,
  QuickNoteProposalPayload,
  QuickNoteResourceReference,
  QuickNoteResourceRole,
  QuickNoteRunDecision,
  QuickNoteRunKind,
} from '@lobechat/types';

export interface QuickNoteEditorData extends Record<string, unknown> {}

/** Input used to atomically create a Quick Note and its backing Document. */
export interface CreateQuickNoteParams {
  /** When this capture becomes eligible for Automatic Analyze. */
  analyzeDueAt?: Date | null;
  /** Optional collection label chosen by the user. */
  collection?: string | null;
  /** Plain-text projection of the rich-text editor content. */
  content?: string;
  /** Rich-text source stored in the backing Document. */
  editorData?: QuickNoteEditorData;
  /** Optional client-generated Quick Note identifier. */
  id?: string;
  /** Optional location hint attached directly to the capture. */
  location?: string | null;
  /**
   * Product objects the capture was sent from, linked as `context` resources.
   *
   * References the caller cannot access are skipped.
   */
  resources?: QuickNoteResourceReference[];
  /** Lightweight labels attached directly to the capture. */
  tags?: string[];
}

/** Mutable source fields persisted by the editor autosave path. */
export interface UpdateQuickNoteContentParams {
  /** When Automatic Analyze becomes eligible for dispatch. */
  analyzeDueAt?: Date | null;
  /** Plain-text projection of the rich-text editor content. */
  content: string;
  /**
   * When to check whether the edit changed the note's meaning. Applied only to a real text change,
   * replacing any earlier due time (debounce: the last edit wins).
   */
  contentCheckDueAt?: Date | null;
  /** Rich-text source stored in the backing Document. */
  editorData: QuickNoteEditorData;
}

/** Input used to claim an immutable processing Run. */
export interface ClaimQuickNoteRunParams {
  /** Processing mode to dispatch for the pinned source revision. */
  kind: QuickNoteRunKind;
  /**
   * Renders the pinned rich-text source into the plain text stored in the Run's input snapshot.
   *
   * Supplied by the caller so the database layer stays free of editor-format knowledge.
   */
  renderSourceText: (editorData: Record<string, unknown>) => string;
  /** Provenance for Analyze; omitted for internal enrichment. */
  trigger?: QuickNoteAnalyzeTrigger;
}

/** Output accepted from a Quick Note Run when it completes. */
export interface CompleteQuickNoteRunParams {
  /** Intent judgement produced by the Run. */
  decision?: QuickNoteRunDecision | null;
  /** Suggested downstream actions persisted without executing them. */
  proposals?: QuickNoteProposalDraft[];
  /** AI overview shown beside the note. */
  summary?: string | null;
  /** Lightweight labels merged onto the Quick Note when its source is still current. */
  tags?: string[];
}

/** A suggested downstream action produced by a Quick Note Run. */
export interface QuickNoteProposalDraft {
  /** Product object family the Proposal would create when applied. */
  kind: QuickNoteProposalKind;
  /** Full arguments of the target action; also stored as the original AI draft. */
  payload: QuickNoteProposalPayload;
  /** Built-in `delegate` preset that produced the Proposal, when any. */
  preset?: QuickNoteDelegatePreset | null;
}

/** Input used to append user context to a Quick Note. */
export interface CreateQuickNoteCommentParams {
  /** Plain-text projection shown in the comment stream. */
  content: string;
  /** Optional rich-text source of the comment. */
  editorData?: QuickNoteEditorData;
}

/** Input used to edit a Quick Note Comment; the new content overwrites the old. */
export interface UpdateQuickNoteCommentParams extends CreateQuickNoteCommentParams {}

/** Input used to persist a typed resource judged relevant to a Quick Note Run. */
export interface LinkQuickNoteResourceParams extends QuickNoteResourceReference {
  /** Meaning of the resource for the Quick Note source revision. */
  role?: QuickNoteResourceRole;
}
