import { z } from 'zod';

import type { ReviewAnchor } from './acceptanceReview';
import type { DocumentCommentJson } from './documentComment';
import type { AcceptanceAttachment, AcceptanceReviewAnnotation } from './verify';

/**
 * Where a discussion thread hangs on the acceptance page.
 *
 * - `acceptance`: the delivery as a whole (the global discussion under the checklist).
 * - `evidence`: a region on one image or video frame of one check.
 */
export type AcceptanceCommentAnchorType = 'acceptance' | 'evidence';

/**
 * What a root row means.
 *
 * - `comment`: a remark in the discussion; never changes the acceptance state.
 * - `approval`: a reviewer saying "this delivery is fine by me" for the round they
 *   looked at. It is an opinion the decider reads, not the terminal accept.
 * - `reaction`: one person's emoji on one comment. Stored as a child row of the
 *   comment it answers, so agreement costs a click instead of another remark.
 * - `proposal`: the round's own note, written by the agent that produced it.
 *   It belongs to the round rather than to the conversation, so the page folds
 *   it into that round's entry instead of listing it as another message.
 * - `access_request`: someone who may only remark asking the deciders for the
 *   right to collaborate on this delivery — send it back, and talk to the
 *   agent bound to it. The answer is server-owned state on the same row
 *   ({@link AcceptanceAccessRequest}).
 */
export type AcceptanceCommentKind =
  'access_request' | 'approval' | 'comment' | 'proposal' | 'reaction';

/**
 * What an access request asks for. `collaborate` is edit-collaboration on one
 * acceptance: rejecting the delivery, and talking to the agent bound to it in
 * the owner's conversation. Accepting a delivery stays with its deciders.
 */
export type AcceptanceAccessPermission = 'collaborate';

/**
 * Where an access request stands.
 *
 * - `pending`: waiting on a decider.
 * - `granted`: the requester collaborates on this acceptance. Whatever they
 *   start — a reject's repair, a message to the bound agent — runs on the
 *   owner's agent, in the owner's conversation.
 * - `declined`: a decider said no; the requester may ask again.
 * - `revoked`: a decider took a grant back.
 */
export type AcceptanceAccessRequestStatus = 'declined' | 'granted' | 'pending' | 'revoked';

export interface AcceptanceAccessRequest {
  decidedAt?: string;
  decidedByUserId?: string;
  permission: AcceptanceAccessPermission;
  status: AcceptanceAccessRequestStatus;
}

export type AcceptanceAccessDecision = 'decline' | 'grant' | 'revoke';

/**
 * A file hung on a comment, as it is STORED: an object rather than a bare id,
 * so a caption or an ordering can join it later without another migration. The
 * read hands back {@link AcceptanceAttachment} instead — the same file with its
 * name and a freshly resolved URL.
 */
export interface AcceptanceCommentAttachmentRef {
  fileId: string;
}

export type AcceptanceCommentSource = ReviewAnchor;

/** A video comment is anchored to a single frame. */
export const acceptanceCommentTimeSchema = z
  .object({
    start: z.number().finite().nonnegative(),
  })
  .strict();

export type AcceptanceCommentTime = z.infer<typeof acceptanceCommentTimeSchema>;

/** Server-owned facts; other comment producers may retain their own keys. */
export interface AcceptanceCommentMetadata extends Record<string, unknown> {
  /** Only on `access_request` rows; never written by a client. */
  accessRequest?: AcceptanceAccessRequest;
  evidenceAnchor?: {
    time: AcceptanceCommentTime;
  };
}

/** One emoji on one comment, already tallied for display. */
export interface AcceptanceCommentReaction {
  /** Display names behind the count, for the "who reacted" tooltip. */
  authorNames: string[];
  count: number;
  emoji: string;
  /** The reading user is one of them, so clicking the chip takes theirs back. */
  mine: boolean;
}

export type AcceptanceCommentAuthorStatus = 'active' | 'deactivated' | 'former';

export interface AcceptanceCommentAuthor {
  avatar: string | null;
  fullName: string | null;
  id: string | null;
  status: AcceptanceCommentAuthorStatus;
  /**
   * `agent` when the row was written by an agent through someone's
   * credentials — the page shows the agent, not the account behind the key.
   */
  type: 'agent' | 'user';
  username: string | null;
}

/** The version-pinned anchor a root comment was written against. */
export interface AcceptanceCommentAnchor {
  anchorType: AcceptanceCommentAnchorType;
  /** Stable union check id (`sourceCriterionId ?? checkItemId`) for evidence anchors. */
  checkItemId?: string | null;
  /** The round the author was looking at when they wrote the comment. */
  contextRunId?: string | null;
  /** The evidence row the region was drawn on. */
  evidenceId?: string | null;
  /** Normalized (0–1) region on the evidence image. */
  rect?: AcceptanceReviewAnnotation['rect'] | null;
  /** Video time in seconds, pinned to this evidence version. */
  time?: AcceptanceCommentTime | null;
}

export interface AcceptanceCommentItem extends AcceptanceCommentAnchor {
  acceptanceId: string;
  /** Set on `access_request` rows only. */
  accessRequest?: AcceptanceAccessRequest | null;
  /**
   * Files hung on the remark, resolved to display URLs by the read. Deliberately
   * NOT inline in the body: a screenshot answering "what do you see instead" is
   * a separate exhibit, and keeping it out of the prose means the plain-text
   * `content` stays readable everywhere the rich body cannot render.
   */
  attachments: AcceptanceAttachment[];
  author: AcceptanceCommentAuthor;
  /** The agent that signed it, when an agent wrote the row. */
  authorAgentId: string | null;
  authorUserId: string | null;
  /**
   * Whether THIS reader may remove the row: its author, or someone who may
   * moderate the acceptance. Never a stand-in for "I wrote this" — compare
   * `authorUserId` for that.
   */
  canDelete: boolean;
  clientId: string;
  content: string;
  /** Round index of `contextRunId`, resolved by the server for display. */
  contextRoundIndex: number | null;
  createdAt: Date;
  deletedAt: Date | null;
  /**
   * The rich body, when a person wrote it in the editor. `content` always holds
   * the markdown form — an agent's note has only that — so a reader with no
   * editor data still gets the words.
   */
  editorData: DocumentCommentJson | null;
  id: string;
  kind: AcceptanceCommentKind;
  parentCommentId: string | null;
  /** Tallied from this comment's reaction rows; empty when nobody reacted. */
  reactions: AcceptanceCommentReaction[];
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  source: AcceptanceCommentSource | null;
  updatedAt: Date;
}

export interface AcceptanceCommentThread {
  replies: AcceptanceCommentItem[];
  root: AcceptanceCommentItem;
}

/** One reviewer's standing opinion: their newest approval row. */
export interface AcceptanceApprovalSummary {
  author: AcceptanceCommentAuthor;
  authorUserId: string;
  contextRoundIndex: number | null;
  createdAt: Date;
}

export interface AcceptanceCommentList {
  /** May the caller approve a round — speak for the delivery rather than about it? */
  canApprove: boolean;
  /** May the caller write comments, annotations and reactions here? */
  canComment: boolean;
  /** May the caller answer access requests — the acceptance's deciders. */
  canManageAccess?: boolean;
  items: AcceptanceCommentItem[];
}

export interface CreateAcceptanceCommentInput {
  acceptanceId: string;
  anchor?: {
    checkItemId: string;
    evidenceId: string;
    rect: AcceptanceReviewAnnotation['rect'];
    time?: AcceptanceCommentTime;
  };
  /** Files to hang on the remark, already uploaded. */
  attachments?: AcceptanceCommentAttachmentRef[];
  /** Who to sign it as, when an agent is writing through a person's key. */
  authorAgentId?: string;
  clientId: string;
  content: string;
  contextRunId?: string;
  /** The editor's own JSON, when the body was written in one. */
  editorData?: DocumentCommentJson;
  /** Reactions and access requests have their own endpoints. */
  kind?: Exclude<AcceptanceCommentKind, 'access_request' | 'reaction'>;
  parentCommentId?: string;
}
