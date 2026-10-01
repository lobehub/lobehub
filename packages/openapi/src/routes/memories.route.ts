import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { getAllScopePermissions } from '@/utils/rbac';

import { zValidator } from '../common/validator';
import { MemoryController } from '../controllers/memory.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import { MemoryCategoryParamSchema, MemoryEntryPathParamSchema } from '../types/memory.type';

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
  describeRoute({
    operationId: 'getMemoryPersona',
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
  describeRoute({
    operationId: 'listMemoryPersonaVersions',
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
  describeRoute({
    operationId: 'deleteAllMemories',
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
  describeRoute({ operationId: 'deleteMemoryEntry', tags: ['memories'] }),
  requireAuth,
  memoryWrite,
  zValidator('param', MemoryEntryPathParamSchema),
  async (c) => new MemoryController().deleteEntry(c),
);

/** GET /api/v1/memories/:category */
MemoryRoutes.get(
  '/:category',
  describeRoute({ operationId: 'listMemoryCategory', tags: ['memories'] }),
  requireAuth,
  memoryRead,
  zValidator('param', MemoryCategoryParamSchema),
  async (c) => new MemoryController().listCategory(c),
);

export default MemoryRoutes;
