import type {
  AcceptanceReviewMarkContext,
  AcceptanceReviewMarkKind,
  AcceptanceReviewPageMeta,
  AcceptanceReviewRect,
  AcceptanceReviewRegionRefs,
  AcceptanceReviewSketch,
  AcceptanceReviewStatus,
  AcceptanceReviewTargets,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { files } from './file';
import { projects } from './project';
import { projectSites } from './projectReview';
import { tasks } from './task';
import { users } from './user';
import { workspaces } from './workspace';

export const acceptanceReviews = pgTable(
  'acceptance_reviews',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    siteId: text('site_id')
      .references(() => projectSites.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),

    status: text('status').$type<AcceptanceReviewStatus>().default('draft').notNull(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    lastMarkSeq: integer('last_mark_seq').default(0).notNull(),

    submittedAt: timestamptz('submitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('acceptance_reviews_site_id_created_at_idx').on(t.siteId, t.createdAt),
    index('acceptance_reviews_task_id_idx').on(t.taskId),
    index('acceptance_reviews_user_id_idx').on(t.userId),
    index('acceptance_reviews_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('acceptance_reviews_one_draft_per_user_unique')
      .on(t.siteId, t.userId)
      .where(sql`${t.status} = 'draft'`),
  ],
);

export const acceptanceReviewMarks = pgTable(
  'acceptance_review_marks',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    reviewId: uuid('review_id')
      .references(() => acceptanceReviews.id, { onDelete: 'cascade' })
      .notNull(),

    seq: integer('seq').notNull(),
    kind: text('kind').$type<AcceptanceReviewMarkKind>().notNull(),
    url: text('url').notNull(),
    routeKey: text('route_key').notNull(),
    pageMeta: jsonb('page_meta').$type<AcceptanceReviewPageMeta>(),
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
    index('acceptance_review_marks_route_key_review_id_idx').on(t.routeKey, t.reviewId),
  ],
);
