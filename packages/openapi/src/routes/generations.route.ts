import { Hono } from 'hono';

import { getAllScopePermissions } from '@/utils/rbac';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { GenerationController } from '../controllers/generation.controller';
import { requireAuth } from '../middleware/auth';
import {
  requireAnyPermissionWithApiKeyScope,
  requireApiKeyScope,
} from '../middleware/permission-check';
import { DeletedResourceSchema } from '../types/common.type';
import {
  GenerationIdParamSchema,
  GenerationListQuerySchema,
  GenerationListResponseSchema,
  GenerationSchema,
} from '../types/generation.type';
import { GENERATION_EXAMPLE } from './generation.examples';

/**
 * Generation routes: the status, results and removal of image / video
 * generations started through `POST /images/generations` and
 * `POST /videos/generations` (or the Image / Video pages).
 *
 * Reads need the `generation:read` API-key scope; a generation the caller
 * cannot see — another user's, another workspace's, a private topic of a
 * teammate — is a 404. Deleting needs `generation:write` plus the file-delete
 * permission, and only the creator or a workspace owner may remove a row.
 */
const GenerationRoutes = new Hono();

const TAGS = ['generations'];

const generationRead = requireApiKeyScope('generation:read');
const generationDelete = requireAnyPermissionWithApiKeyScope(
  getAllScopePermissions('FILE_DELETE'),
  'generation:write',
  'You do not have permission to delete generations',
);

/** GET /api/v1/generations */
GenerationRoutes.get(
  '/',
  routeDoc({
    data: GenerationListResponseSchema,
    description:
      'Lists the image, video and music generations the caller can see, newest first. Filter by `type`; page with `cursor` / `limit`.',
    responseExample: { hasMore: false, items: [GENERATION_EXAMPLE], nextCursor: null, total: 1 },
    summary: 'List generations',
    tags: TAGS,
  }),
  requireAuth,
  generationRead,
  zValidator('query', GenerationListQuerySchema),
  async (c) => new GenerationController().listGenerations(c),
);

/** GET /api/v1/generations/:id */
GenerationRoutes.get(
  '/:id',
  routeDoc({
    data: GenerationSchema,
    description:
      'Reports one generation: its `status` (`pending`, `processing`, `success` or `error`), the asset URLs once it succeeded, or the failure reason. Poll until the status is `success` or `error` — the SDK does this in `generations.wait(id)`.',
    errors: [404],
    responseExample: GENERATION_EXAMPLE,
    summary: 'Get a generation',
    tags: TAGS,
  }),
  requireAuth,
  generationRead,
  zValidator('param', GenerationIdParamSchema),
  async (c) => new GenerationController().getGeneration(c),
);

/** DELETE /api/v1/generations/:id */
GenerationRoutes.delete(
  '/:id',
  routeDoc({
    data: DeletedResourceSchema,
    description:
      'Deletes a generation record and its thumbnail. The library file it was saved as is kept. In a workspace only the creator or a workspace owner may delete it.',
    errors: [404],
    responseExample: { deleted: true, id: GENERATION_EXAMPLE.id },
    summary: 'Delete a generation',
    tags: TAGS,
  }),
  requireAuth,
  generationDelete,
  zValidator('param', GenerationIdParamSchema),
  async (c) => new GenerationController().deleteGeneration(c),
);

export default GenerationRoutes;
