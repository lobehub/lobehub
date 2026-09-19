import type {
  AcceptanceCommentAnchorType,
  AcceptanceCommentAttachmentRef,
  AcceptanceCommentKind,
  AcceptanceReviewAnnotation,
  DocumentCommentJson,
} from '@lobechat/types';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { acceptances, verifyEvidence, verifyRuns } from './verify';
import { workspaces } from './workspace';

/**
 * Human collaboration on an acceptance: the global discussion under the
 * checklist, regions circled on evidence images, and reviewers' approvals.
 * Rows never enter the verify execution tables — a comment changes no check
 * result, no round, and no acceptance status. The decider still closes the
 * acceptance through `verify_runs.user_decision`.
 */
/**
 * Short on purpose: this id is the addressable part of a comment's URL, and a
 * 36-character uuid was most of the fragment. Twelve characters of the shared
 * 62-symbol alphabet leave 62^12 ≈ 3.2e21 values — a one-in-a-billion chance of
 * any collision only arrives at ~2.5M comments, and the primary key would turn
 * one into a failed insert rather than a mixed-up row.
 */
const commentId = createNanoId(12);

export const acceptanceComments = pgTable(
  'acceptance_comments',
  {
    id: text('id')
      .$defaultFn(() => commentId())
      .notNull()
      .primaryKey(),
    acceptanceId: uuid('acceptance_id')
      .references(() => acceptances.id, { onDelete: 'cascade' })
      .notNull(),
    /** Nullable so the discussion survives an author's account deletion. */
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Set when the row was written BY an agent rather than by the person whose
     * credentials carried it. A round's own note is signed by the agent that
     * produced the round; `author_user_id` still records whose account wrote
     * it, which is what ownership and deletion continue to key on.
     */
    authorAgentId: text('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Copied from the acceptance; null for a personal-scope acceptance. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Thread root. Every reply points directly at the root; roots are null. */
    parentCommentId: text('parent_comment_id').references((): AnyPgColumn => acceptanceComments.id),
    /**
     * `comment` (a remark), `approval` (a reviewer's "fine by me" for a round),
     * `reaction` (one emoji on one comment), or `proposal` (the round's own
     * note, which renders as part of the round rather than as a message).
     */
    kind: text('kind').$type<AcceptanceCommentKind>().default('comment').notNull(),

    /** `acceptance` for the global discussion, `evidence` for a circled region. */
    anchorType: text('anchor_type')
      .$type<AcceptanceCommentAnchorType>()
      .default('acceptance')
      .notNull(),
    /**
     * The round the author was looking at. Kept apart from `evidence_id`: a
     * viewer on round 4 may circle a C2 screenshot that round 4 inherited from
     * round 2, and both facts matter when the next round arrives.
     */
    contextRunId: uuid('context_run_id').references(() => verifyRuns.id, {
      onDelete: 'set null',
    }),
    /** Union check id (`sourceCriterionId ?? checkItemId`) for evidence anchors. */
    checkItemId: text('check_item_id'),
    evidenceId: uuid('evidence_id').references(() => verifyEvidence.id, { onDelete: 'set null' }),
    /** Normalized (0–1) region on the evidence image, e.g. { x: 0.2, y: 0.1, width: 0.3, height: 0.2 }. */
    anchorRect: jsonb('anchor_rect').$type<AcceptanceReviewAnnotation['rect']>(),

    content: text('content').notNull(),
    /**
     * The rich body as the editor stored it. `content` keeps the markdown form
     * beside it — same pair as `document_comments` — so an agent's note (which
     * only ever has markdown) and a person's rich remark render through one
     * component, and search or notifications always have plain words to use.
     */
    editorData: jsonb('editor_data').$type<DocumentCommentJson>(),
    /**
     * Files hung on the remark: a list of objects carrying the file id, resolved
     * to signed URLs on read. Objects rather than bare ids so a caption or an
     * ordering can join later without a migration; storing the URL would freeze
     * a presigned link that expires, and storing them apart from the body keeps
     * an attachment an exhibit rather than prose.
     */
    attachments: jsonb('attachments').$type<AcceptanceCommentAttachmentRef[]>(),
    /** Client-generated idempotency key for retried creates. */
    clientId: text('client_id').notNull(),

    /** Set on a root when a participant marks the thread handled; independent of round staleness. */
    resolvedAt: timestamptz('resolved_at'),
    resolvedByUserId: text('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Tombstone retained only while a deleted root still has replies. */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('acceptance_comments_acceptance_id_author_user_id_client_id_unique').on(
      t.acceptanceId,
      t.authorUserId,
      t.clientId,
    ),
    index('acceptance_comments_acceptance_id_created_at_id_idx').on(
      t.acceptanceId,
      t.createdAt,
      t.id,
    ),
    index('acceptance_comments_parent_comment_id_idx').on(t.parentCommentId),
    index('acceptance_comments_evidence_id_idx').on(t.evidenceId),
    index('acceptance_comments_author_user_id_idx').on(t.authorUserId),
    index('acceptance_comments_author_agent_id_idx').on(t.authorAgentId),
    index('acceptance_comments_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAcceptanceComment = typeof acceptanceComments.$inferInsert;
export type AcceptanceCommentRow = typeof acceptanceComments.$inferSelect;
