import {
  TRASH_RESOURCE_TYPES,
  TRASH_RESTORE_ERROR_CODES,
  TRASH_VISIBILITIES,
} from '@lobechat/types';
import { z } from 'zod';

import { CursorPaginationQuerySchema, paginatedListSchema } from '../helpers/pagination';
import { dateTimeSchema } from './common.type';

export const TrashResourceTypeSchema = z
  .enum(TRASH_RESOURCE_TYPES)
  .describe('Kind of the deleted resource.')
  .meta({ id: 'TrashResourceType' });

const VisibilitySchema = z
  .enum(TRASH_VISIBILITIES)
  .describe(
    'Workspace bins only. `public`: roots every member could see before deletion. `private`: your own deletions of private resources. Omitted: only your own deletions. Ignored outside a workspace.',
  );

/** Query-string value meaning "roots recorded without a project". */
export const TRASH_NO_PROJECT = 'none';

const ProjectFilterSchema = z
  .string()
  .min(1)
  .describe(
    `Only roots deleted from this project; \`${TRASH_NO_PROJECT}\` for roots recorded without a project. Omit for every project.`,
  );

const filterShape = {
  projectId: ProjectFilterSchema.optional(),
  visibility: VisibilitySchema.optional(),
};

export const TrashListQuerySchema = z.object({
  ...CursorPaginationQuerySchema.shape,
  ...filterShape,
  resourceType: TrashResourceTypeSchema.optional(),
});

export const TrashCountsQuerySchema = z.object(filterShape);

export const TrashIdsRequestSchema = z
  .object({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(200)
      .describe('Trash item ids (the `id` of a list entry, not the resource id), at most 200.'),
  })
  .strict();

export const EmptyTrashRequestSchema = z
  .object({ ...filterShape, resourceType: TrashResourceTypeSchema.optional() })
  .strict();

export const TrashItemSchema = z
  .object({
    deletedAt: dateTimeSchema,
    deletedByUserId: z.string().nullable().describe('Who moved it to the trash.'),
    expiresAt: dateTimeSchema.describe('When it is purged automatically.'),
    id: z.string().describe('Trash item id, used to restore or purge.'),
    meta: z
      .object({
        avatar: z.string().nullable().optional(),
        backgroundColor: z.string().nullable().optional(),
        childCount: z
          .number()
          .int()
          .optional()
          .describe('Resources deleted together with this one (topics under an agent, …).'),
        kind: z.string().nullable().optional(),
        parentTitle: z.string().nullable().optional(),
        private: z.boolean().optional(),
        role: z.string().nullable().optional().describe('Messages only: the message role.'),
        size: z.number().nullable().optional(),
      })
      .strict()
      .nullable()
      .describe('Snapshot taken at deletion time for display.'),
    resourceId: z.string().describe('Id of the deleted resource.'),
    resourceType: TrashResourceTypeSchema,
    title: z.string().nullable(),
    workspaceId: z.string().nullable(),
  })
  .strict()
  .meta({ id: 'TrashItem' });

export const TrashListSchema = paginatedListSchema(TrashItemSchema);

export const TrashCountsSchema = z
  .object({
    byType: z
      .object(
        Object.fromEntries(TRASH_RESOURCE_TYPES.map((type) => [type, z.number().int().min(0)])) as {
          [K in (typeof TRASH_RESOURCE_TYPES)[number]]: z.ZodNumber;
        },
      )
      .strict()
      .describe('Number of trash items per resource type.'),
    total: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'TrashCounts' });

export const TrashRestoreResultSchema = z
  .object({
    failed: z
      .array(
        z
          .object({
            code: z
              .enum(TRASH_RESTORE_ERROR_CODES)
              .describe(
                '`notFound`: not in your trash or already gone. `parentTrashed`: restore its parent first. `conflict`: a live resource took its place.',
              ),
            id: z.string(),
          })
          .strict(),
      )
      .describe('Items that could not be restored; the others were.'),
    restored: z.array(TrashItemSchema),
  })
  .strict()
  .meta({ id: 'TrashRestoreResult' });

export const TrashPurgeResultSchema = z
  .object({
    blocked: z
      .array(z.string())
      .describe('Ids that cannot be purged right now (for example still in use); they stay.'),
    purged: z.number().int().min(0).describe('Items permanently deleted.'),
  })
  .strict()
  .meta({ id: 'TrashPurgeResult' });

export const EmptyTrashResultSchema = z
  .object({
    blocked: z.number().int().min(0),
    hasMore: z
      .boolean()
      .describe('More items match: call again with the same filter until this is `false`.'),
    purged: z.number().int().min(0),
  })
  .strict()
  .meta({ id: 'EmptyTrashResult' });

export type TrashListQuery = z.infer<typeof TrashListQuerySchema>;
export type TrashCountsQuery = z.infer<typeof TrashCountsQuerySchema>;
export type TrashIdsRequest = z.infer<typeof TrashIdsRequestSchema>;
export type EmptyTrashRequest = z.infer<typeof EmptyTrashRequestSchema>;
export type TrashItemResponse = z.infer<typeof TrashItemSchema>;
