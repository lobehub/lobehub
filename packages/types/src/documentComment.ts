export type DocumentCommentAuthorStatus = 'active' | 'deactivated' | 'former';

/**
 * Where a root comment is anchored inside the document body, captured from the
 * reader's selection at create time.
 *
 * Deliberately a *text* selector, not a structural one. Lexical node keys are
 * regenerated on every load (the document hydrates through
 * `setDocument('json', …)` without `keepId`), so any persisted node id / child
 * index is dead on the next refresh. Storing the quoted text instead means the
 * anchor re-locates itself against whatever the body says now, and survives
 * edits anywhere else in the document.
 *
 * `quote` doubles as the anchor's snapshot: once the quoted run is edited away
 * the comment can no longer be painted in the body, but the card still shows
 * what was being talked about. Nothing re-writes these fields after creation —
 * re-location is a pure client-side read.
 */
export interface DocumentCommentSelectionAnchor {
  /** Offset just past the quote, equal to `start + quote.length` at capture time. */
  end: number;
  /** Text immediately before the quote, used to disambiguate repeated quotes. */
  prefix?: string;
  /** The selected text. The re-location key and the human-readable excerpt. */
  quote: string;
  /** Offset of the quote in the document's flattened text at capture time. */
  start: number;
  /** Text immediately after the quote, used to disambiguate repeated quotes. */
  suffix?: string;
}

export type DocumentCommentJson =
  boolean | number | string | null | DocumentCommentJson[] | { [key: string]: DocumentCommentJson };

export interface DocumentCommentAuthor {
  avatar: string | null;
  fullName: string | null;
  id: string | null;
  status: DocumentCommentAuthorStatus;
  username: string | null;
}

export interface DocumentCommentItem {
  author: DocumentCommentAuthor;
  authorUserId: string | null;
  canDelete: boolean;
  canEdit: boolean;
  clientId: string;
  content: string;
  createdAt: Date;
  deletedAt: Date | null;
  documentId: string;
  editorData: DocumentCommentJson | null;
  id: string;
  parentCommentId: string | null;
  replyTo: { author: DocumentCommentAuthor; id: string } | null;
  replyToCommentId: string | null;
  updatedAt: Date;
  workspaceId: string;
}

/** One comment fetched by id; roots also carry their live reply count. */
export interface DocumentCommentDetail extends DocumentCommentItem {
  replyCount: number;
}

export interface DocumentCommentThread {
  replyCount: number;
  root: DocumentCommentItem;
}

export interface DocumentCommentThreadPage {
  items: DocumentCommentThread[];
  nextCursor: string | null;
}

export interface DocumentCommentReplyPage {
  items: DocumentCommentItem[];
  nextCursor: string | null;
  total?: number;
}

export interface DocumentCommentSummary {
  total: number;
}

export interface CreateDocumentCommentInput {
  clientId: string;
  content: string;
  documentId: string;
  editorData?: DocumentCommentJson;
  parentCommentId?: string;
}

export interface UpdateDocumentCommentInput {
  content?: string;
  editorData?: DocumentCommentJson;
  id: string;
}
