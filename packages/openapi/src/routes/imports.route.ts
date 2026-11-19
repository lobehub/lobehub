import { Hono } from 'hono';

import { API_KEY_FULL_ACCESS_SCOPE } from '@/const/apiKeyScope';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { DataTransferController } from '../controllers/data-transfer.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { CreateImportRequestSchema, ImportResultSchema } from '../types/data-transfer.type';

/**
 * Data import — the REST twin of the tRPC `importer` router. An import can
 * overwrite credential-bearing settings, provider/model configuration and
 * agents, so like the tRPC namespace it is closed to restricted API keys:
 * only a full-access key (`*`), a session or an OIDC token may import. Inside
 * a workspace the shared procedure additionally reserves it for the owner.
 */
const ImportsRoutes = new Hono();

/** POST /api/v1/imports */
ImportsRoutes.post(
  '/',
  routeDoc({
    data: ImportResultSchema,
    description:
      'Imports data into your account (or, with `X-Workspace-Id`, the workspace — owner only). Send a `json` export inline with `source: "export"` (spread its `data` and `schemaHash`), a legacy LobeChat config with `source: "legacy"`, or point at one of your uploaded files with `source: "file"`. Rows that already exist are skipped and rows that cannot be written are counted under `errors`; when the import cannot run at all the call answers 422 and nothing is written. Needs a full-access API key.',
    errors: [404, 422, 503],
    operationId: 'imports.create',
    requestExample: example(CreateImportRequestSchema, {
      data: { agents: [{ id: 'agt_6sQwJ3dVbX1m', title: 'Code Reviewer' }] },
      schemaHash: '9a1f3c…',
      source: 'export',
    }),
    responseExample: { results: { agents: { added: 1, errors: 0, skips: 0 } } },
    summary: 'Import account or workspace data',
    tags: ['imports'],
  }),
  requireAuth,
  requireApiKeyScope(API_KEY_FULL_ACCESS_SCOPE),
  zValidator('json', CreateImportRequestSchema),
  async (c) => new DataTransferController().createImport(c),
);

export default ImportsRoutes;
