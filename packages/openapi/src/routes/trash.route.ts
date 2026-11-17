import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { TrashController } from '../controllers/trash.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  EmptyTrashRequestSchema,
  EmptyTrashResultSchema,
  TrashCountsQuerySchema,
  TrashCountsSchema,
  TrashIdsRequestSchema,
  TrashListQuerySchema,
  TrashListSchema,
  TrashPurgeResultSchema,
  TrashRestoreResultSchema,
} from '../types/trash.type';

/**
 * The recycle bin. Without `X-Workspace-Id` it is the caller's personal bin.
 * In a workspace each member manages what they deleted; owners and admins also
 * manage the `public` side (roots every member could see), and a member's
 * `private` deletions stay theirs alone. Purging reaches every resource type,
 * so it has its own `trash:*` scopes rather than each resource's write scope.
 */
const TrashRoutes = new Hono();

const read = requireApiKeyScope('trash:read');
const write = requireApiKeyScope('trash:write');

/** GET /api/v1/trash */
TrashRoutes.get(
  '/',
  routeDoc({
    data: TrashListSchema,
    description:
      'Deleted roots, newest deletion first. Resources deleted together with a parent (topics under an agent) are restored and purged through that parent and are not listed on their own.',
    // 404: the `projectId` filter names a project the caller cannot read.
    errors: [404],
    operationId: 'trash.list',
    summary: 'List trash items',
    tags: ['trash'],
  }),
  requireAuth,
  read,
  zValidator('query', TrashListQuerySchema),
  async (c) => new TrashController().listItems(c),
);

/** GET /api/v1/trash/counts */
TrashRoutes.get(
  '/counts',
  routeDoc({
    data: TrashCountsSchema,
    errors: [404],
    operationId: 'trash.counts',
    summary: 'Count trash items by resource type',
    tags: ['trash'],
  }),
  requireAuth,
  read,
  zValidator('query', TrashCountsQuerySchema),
  async (c) => new TrashController().counts(c),
);

/** POST /api/v1/trash/restore */
TrashRoutes.post(
  '/restore',
  routeDoc({
    data: TrashRestoreResultSchema,
    description:
      "Each item is restored on its own: one that cannot come back is reported in `failed` (an id outside your bin as `notFound`) and does not block the rest. In a workspace, restoring another member's deletion needs the owner or admin role and a public item (403 otherwise).",
    operationId: 'trash.restore',
    summary: 'Restore trash items',
    tags: ['trash'],
  }),
  requireAuth,
  write,
  zValidator('json', TrashIdsRequestSchema),
  async (c) => new TrashController().restore(c),
);

/** POST /api/v1/trash/purge */
TrashRoutes.post(
  '/purge',
  routeDoc({
    data: TrashPurgeResultSchema,
    description:
      "Permanently deletes the items and everything deleted with them; this cannot be undone. Ids outside your bin are skipped. In a workspace, purging another member's deletion needs the owner or admin role and a public item (403 otherwise).",
    operationId: 'trash.purge',
    summary: 'Permanently delete trash items',
    tags: ['trash'],
  }),
  requireAuth,
  write,
  zValidator('json', TrashIdsRequestSchema),
  async (c) => new TrashController().purge(c),
);

/** POST /api/v1/trash/empty */
TrashRoutes.post(
  '/empty',
  routeDoc({
    data: EmptyTrashResultSchema,
    description:
      'Permanently deletes one bounded batch of the matching items; repeat with the same filter while `hasMore` is `true`. In a workspace, emptying the `public` side needs the owner or admin role (403); without `visibility` only your own deletions are emptied.',
    errors: [404],
    operationId: 'trash.empty',
    summary: 'Empty the trash',
    tags: ['trash'],
  }),
  requireAuth,
  write,
  zValidator('json', EmptyTrashRequestSchema),
  async (c) => new TrashController().empty(c),
);

export default TrashRoutes;
