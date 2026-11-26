import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { MemoryController } from '../controllers/memory.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import {
  MemoryCategoryEntriesSchema,
  MemoryCategoryParamSchema,
  MemoryEntryPathParamSchema,
  MemoryPersonaSchema,
  MemoryPersonaVersionSchema,
} from '../types/memory.type';

/**
 * User memory routes.
 *
 * This is the "durable memory" half of a personal agent: the persona the agent
 * plans from, and the per-category entries it has learned.
 *
 * Both gates mirror the delegated-key contract for `userMemory` in
 * `packages/const/src/apiKeyScope.ts`. RBAC answers "may this user touch
 * memory", the API-key scope answers "was this key delegated that capability";
 * `message:create` alone is not enough, because it projects to `chat:write` and
 * would let any restricted chat key read the persona and purge every memory.
 */
const MemoryRoutes = new Hono();

const memoryWrite = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('MESSAGE_CREATE'),
  'user:write',
  'You do not have permission to manage memory',
);

/** Reading the persona and learned entries is the `user:read` capability. */
const memoryRead = requireApiKeyScope('user:read');

/** GET /api/v1/memories/persona */
MemoryRoutes.get(
  '/persona',
  routeDoc({
    data: MemoryPersonaSchema.nullable(),
    description: '`data` is null until a persona has been written.',
    summary: 'Get the current persona document',
    tags: ['memories'],
  }),
  requireAuth,
  memoryRead,
  async (c) => new MemoryController().getPersona(c),
);

/** GET /api/v1/memories/persona/versions */
MemoryRoutes.get(
  '/persona/versions',
  routeDoc({
    data: z.array(MemoryPersonaVersionSchema),
    summary: 'List persona document versions',
    tags: ['memories'],
  }),
  requireAuth,
  memoryRead,
  async (c) => new MemoryController().listPersonaVersions(c),
);

/** DELETE /api/v1/memories — purge everything and allow re-extraction. */
MemoryRoutes.delete(
  '/',
  routeDoc({
    data: DeletedResourcesSchema,
    description:
      'Removes every memory, the persona and the per-topic extraction status; `count` is the number of memories removed.',
    operationId: 'memories.deleteAll',
    summary: 'Delete all memory entries',
    tags: ['memories'],
  }),
  requireAuth,
  memoryWrite,
  async (c) => new MemoryController().deleteAll(c),
);

/** DELETE /api/v1/memories/:category/:id */
MemoryRoutes.delete(
  '/:category/:id',
  routeDoc({
    data: DeletedResourceSchema,
    errors: [404],
    operationId: 'memories.deleteEntry',
    summary: 'Delete a memory entry',
    tags: ['memories'],
  }),
  requireAuth,
  memoryWrite,
  zValidator('param', MemoryEntryPathParamSchema),
  async (c) => new MemoryController().deleteEntry(c),
);

/** GET /api/v1/memories/:category */
MemoryRoutes.get(
  '/:category',
  routeDoc({
    data: MemoryCategoryEntriesSchema,
    description:
      'Every identity, or the newest entries of the other categories; the array shape follows `category`.',
    operationId: 'memories.listCategory',
    summary: 'List the entries of a memory category',
    tags: ['memories'],
  }),
  requireAuth,
  memoryRead,
  zValidator('param', MemoryCategoryParamSchema),
  async (c) => new MemoryController().listCategory(c),
);

export default MemoryRoutes;
