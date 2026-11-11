import type {
  AcceptanceReviewMarkContext,
  AcceptanceReviewMarkKind,
  AcceptanceReviewRect,
  AcceptanceReviewRegionRefs,
  AcceptanceReviewSketch,
  AcceptanceReviewStatus,
  AcceptanceReviewTargets,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { files } from './file';
import { projects } from './project';
import { tasks } from './task';
import { users } from './user';
import { acceptances } from './verify';
import { workspaces } from './workspace';

const reviewId = createNanoId(12);
const markId = createNanoId(12);

export const acceptanceReviews = pgTable(
  'acceptance_reviews',
  {
    id: text('id')
      .$defaultFn(() => reviewId())
      .notNull()
      .primaryKey(),
    acceptanceId: uuid('acceptance_id')
      .references(() => acceptances.id, { onDelete: 'cascade' })
      .notNull(),
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),

    status: text('status').$type<AcceptanceReviewStatus>().default('draft').notNull(),
    pageUrl: text('page_url').notNull(),
    route: text('route').notNull(),
    pageTitle: text('page_title'),
    title: text('title'),
    summary: text('summary'),
    agentId: text('agent_id'),
    lastMarkSeq: integer('last_mark_seq').default(0).notNull(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    deliveryAcceptanceId: uuid('delivery_acceptance_id').references(() => acceptances.id, {
      onDelete: 'set null',
    }),

    submittedAt: timestamptz('submitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('acceptance_reviews_acceptance_route_created_idx').on(
      t.acceptanceId,
      t.route,
      t.createdAt,
    ),
    index('acceptance_reviews_task_id_idx').on(t.taskId),
    index('acceptance_reviews_delivery_acceptance_id_idx').on(t.deliveryAcceptanceId),
    index('acceptance_reviews_author_user_id_idx').on(t.authorUserId),
    index('acceptance_reviews_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('acceptance_reviews_one_draft_per_author_unique')
      .on(t.acceptanceId, t.authorUserId)
      .where(sql`${t.status} = 'draft'`),
  ],
);

export const acceptanceReviewMarks = pgTable(
  'acceptance_review_marks',
  {
    id: text('id')
      .$defaultFn(() => markId())
      .notNull()
      .primaryKey(),
    reviewId: text('review_id')
      .references(() => acceptanceReviews.id, { onDelete: 'cascade' })
      .notNull(),

    seq: integer('seq').notNull(),
    kind: text('kind').$type<AcceptanceReviewMarkKind>().notNull(),
    pageUrl: text('page_url').notNull(),
    route: text('route').notNull(),
    rectDocument: jsonb('rect_document').$type<AcceptanceReviewRect>().notNull(),
    rectViewport: jsonb('rect_viewport').$type<AcceptanceReviewRect>().notNull(),
    scroll: jsonb('scroll').$type<{ x: number; y: number }>().notNull(),
    viewport: jsonb('viewport').$type<{ dpr: number; height: number; width: number }>().notNull(),
    regions: jsonb('regions').$type<AcceptanceReviewRect[]>(),
    regionRefs: jsonb('region_refs').$type<AcceptanceReviewRegionRefs>(),
    targets: jsonb('targets').$type<AcceptanceReviewTargets>(),
    sketch: jsonb('sketch').$type<AcceptanceReviewSketch>(),
    context: jsonb('context').$type<AcceptanceReviewMarkContext>(),
    screenshotFileId: text('screenshot_file_id').references(() => files.id, {
      onDelete: 'set null',
    }),
    content: text('content').notNull(),
    clientId: text('client_id').notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('acceptance_review_marks_review_id_client_id_unique').on(t.reviewId, t.clientId),
    uniqueIndex('acceptance_review_marks_review_id_seq_unique').on(t.reviewId, t.seq),
  ],
);

export type AcceptanceReviewRow = typeof acceptanceReviews.$inferSelect;
export type NewAcceptanceReview = typeof acceptanceReviews.$inferInsert;
export type AcceptanceReviewMarkRow = typeof acceptanceReviewMarks.$inferSelect;
export type NewAcceptanceReviewMark = typeof acceptanceReviewMarks.$inferInsert;
