import { Hono } from 'hono';
import { z } from 'zod';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { MemoryController } from '../controllers/memory.controller';
import {
  MemoryWriteController,
  type WritableMemoryCategory,
} from '../controllers/memory-write.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import { DeletedResourceSchema, DeletedResourcesSchema } from '../types/common.type';
import {
  MemoryActivitySchema,
  MemoryCategoryEntriesSchema,
  MemoryCategoryParamSchema,
  MemoryContextSchema,
  MemoryEntryIdParamSchema,
  MemoryEntryPathParamSchema,
  MemoryExperienceSchema,
  MemoryIdentitySchema,
  MemoryPersonaSchema,
  MemoryPersonaVersionSchema,
  MemoryPreferenceSchema,
} from '../types/memory.type';
import {
  CreateMemoryActivitySchema,
  CreateMemoryContextSchema,
  CreateMemoryExperienceSchema,
  CreateMemoryIdentitySchema,
  CreateMemoryPreferenceSchema,
  MemoryExtractionTaskIdParamSchema,
  MemoryExtractionTaskSchema,
  MemorySearchRequestSchema,
  MemorySearchResultSchema,
  PersonaVersionIdParamSchema,
  RestoredPersonaSchema,
  StartMemoryExtractionSchema,
  UpdateMemoryActivitySchema,
  UpdateMemoryContextSchema,
  UpdateMemoryExperienceSchema,
  UpdateMemoryIdentitySchema,
  UpdateMemoryPreferenceSchema,
} from '../types/memory-write.type';

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

/**
 * Extraction runs model calls over the user's conversations, on top of the
 * memory write — the same extra bar as `userMemory.requestMemoryFromChatTopic`
 * in `TRPC_PROCEDURE_EXTRA_SCOPES`.
 */
const modelInvoke = requireApiKeyScope('model:invoke');

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

/** POST /api/v1/memories/search — semantic + keyword retrieval across layers. */
MemoryRoutes.post(
  '/search',
  routeDoc({
    data: MemorySearchResultSchema,
    description:
      'Embeds `queries` and ranks every memory layer by semantic, keyword and recency signals (the retrieval the agent memory tool uses). Send `topicId` instead to retrieve the memories relevant to a conversation topic; the other filters then do not apply. A failing embedding provider yields empty layers rather than an error. Memory belongs to the user, not to a workspace: a workspace-bound key searches the same personal memory.',
    errors: [404],
    operationId: 'memories.search',
    summary: 'Search memories',
    tags: ['memories'],
  }),
  requireAuth,
  memoryRead,
  zValidator('json', MemorySearchRequestSchema),
  async (c) => new MemoryWriteController().search(c),
);

/** POST /api/v1/memories/extractions — extract memories from chat topics, async. */
MemoryRoutes.post(
  '/extractions',
  routeDoc({
    data: MemoryExtractionTaskSchema,
    description:
      'Queues memory extraction over the caller’s chat topics in the optional date range and answers at once with the async task; poll `GET /memories/extractions/{id}`. While one extraction is running, the same task is returned with `deduped: true`. Needs `model:invoke` as well as `user:write`.',
    operationId: 'memories.startExtraction',
    status: 202,
    summary: 'Start a memory extraction',
    tags: ['memories'],
  }),
  requireAuth,
  memoryWrite,
  modelInvoke,
  zValidator('json', StartMemoryExtractionSchema),
  async (c) => new MemoryWriteController().startExtraction(c),
);

/** GET /api/v1/memories/extractions/:id */
MemoryRoutes.get(
  '/extractions/:id',
  routeDoc({
    data: MemoryExtractionTaskSchema,
    errors: [404],
    operationId: 'memories.getExtraction',
    summary: 'Get a memory extraction task',
    tags: ['memories'],
  }),
  requireAuth,
  memoryRead,
  zValidator('param', MemoryExtractionTaskIdParamSchema),
  async (c) => new MemoryWriteController().getExtraction(c),
);

/** POST /api/v1/memories/persona/versions/:id/restore */
MemoryRoutes.post(
  '/persona/versions/:id/restore',
  routeDoc({
    data: RestoredPersonaSchema,
    description:
      'Makes a previous persona version current again by writing it as a new version. Personal scope only: answers 403 with `X-Workspace-Id`. Answers 412 when that version has no stored snapshot.',
    errors: [404, 412],
    operationId: 'memories.restorePersonaVersion',
    summary: 'Restore a persona version',
    tags: ['memories'],
  }),
  requireAuth,
  memoryWrite,
  zValidator('param', PersonaVersionIdParamSchema),
  async (c) => new MemoryWriteController().restorePersonaVersion(c),
);

/** Per-layer write contracts: the create body, the patch body and the entry returned. */
const WRITABLE_LAYERS = [
  {
    category: 'identities',
    create: CreateMemoryIdentitySchema,
    entry: MemoryIdentitySchema,
    name: 'Identity',
    update: UpdateMemoryIdentitySchema,
  },
  {
    category: 'preferences',
    create: CreateMemoryPreferenceSchema,
    entry: MemoryPreferenceSchema,
    name: 'Preference',
    update: UpdateMemoryPreferenceSchema,
  },
  {
    category: 'contexts',
    create: CreateMemoryContextSchema,
    entry: MemoryContextSchema,
    name: 'Context',
    update: UpdateMemoryContextSchema,
  },
  {
    category: 'activities',
    create: CreateMemoryActivitySchema,
    entry: MemoryActivitySchema,
    name: 'Activity',
    update: UpdateMemoryActivitySchema,
  },
  {
    category: 'experiences',
    create: CreateMemoryExperienceSchema,
    entry: MemoryExperienceSchema,
    name: 'Experience',
    update: UpdateMemoryExperienceSchema,
  },
] as const satisfies readonly ({ category: WritableMemoryCategory; name: string } & Record<
  string,
  unknown
>)[];

for (const layer of WRITABLE_LAYERS) {
  const label = layer.name.toLowerCase();

  /** POST /api/v1/memories/:category */
  MemoryRoutes.post(
    `/${layer.category}`,
    routeDoc({
      data: layer.entry,
      description: `Writes a ${label} memory and embeds its text so \`POST /memories/search\` can find it; answers with the stored entry. Memory belongs to the user, not to a workspace: a workspace-bound key writes the same personal memory.`,
      operationId: `memories.create${layer.name}`,
      status: 201,
      summary: `Create a ${label} memory`,
      tags: ['memories'],
    }),
    requireAuth,
    memoryWrite,
    zValidator('json', layer.create),
    async (c) => new MemoryWriteController().createEntry(c, layer.category),
  );

  /** PATCH /api/v1/memories/:category/:id */
  MemoryRoutes.patch(
    `/${layer.category}/:id`,
    routeDoc({
      data: layer.entry,
      description: `Patches a ${label} memory the caller owns. Memory belongs to the user, not to a workspace, so a workspace-bound key edits the same personal memory.`,
      errors: [404],
      operationId: `memories.update${layer.name}`,
      summary: `Update a ${label} memory`,
      tags: ['memories'],
    }),
    requireAuth,
    memoryWrite,
    zValidator('param', MemoryEntryIdParamSchema),
    zValidator('json', layer.update),
    async (c) => new MemoryWriteController().updateEntry(c, layer.category),
  );
}

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
