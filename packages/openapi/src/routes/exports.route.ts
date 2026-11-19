import { Hono } from 'hono';

import { API_KEY_FULL_ACCESS_SCOPE } from '@/const/apiKeyScope';

import { example } from '../common/examples';
import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { DataTransferController } from '../controllers/data-transfer.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import {
  CreateExportRequestSchema,
  ExportIdParamSchema,
  ExportSchema,
} from '../types/data-transfer.type';

/**
 * Data export — the REST twin of the tRPC `exporter` router.
 *
 * A `json` export is a whole-account backup: settings (including stored
 * provider keys and market tokens), provider and model configuration, agents
 * and conversations. That is why the tRPC catalog blocks `exporter` for
 * restricted keys, and the same holds here — only a full-access key (`*`), a
 * session or an OIDC token may export. Inside a workspace the shared procedure
 * additionally reserves it for the workspace owner.
 */
const ExportsRoutes = new Hono();

const fullAccess = requireApiKeyScope(API_KEY_FULL_ACCESS_SCOPE);

const EXPORT_EXAMPLE = {
  downloadUrl: 'https://files.lobehub.com/exports/…?X-Amz-Signature=…',
  expiresAt: '2026-01-15T09:30:00.000Z',
  filename: 'lobehub-export-exp_V1StGXR8Z5jdHi6B.json',
  format: 'json' as const,
  id: 'exp_V1StGXR8Z5jdHi6B',
  size: 48_213,
  status: 'completed' as const,
};

/** POST /api/v1/exports */
ExportsRoutes.post(
  '/',
  routeDoc({
    data: ExportSchema,
    description:
      'Exports your data and stores the file for download. `format: "json"` dumps the whole account — or, with `X-Workspace-Id`, the workspace (owner only) — in the shape `POST /imports` accepts with `source: "export"`; `format: "pdf"` renders the given Markdown. The file is stored privately and kept for 24 hours: the response carries a signed `downloadUrl`, `GET /exports/{id}` returns a fresh one until the export expires, then answers 404. Needs a full-access API key because the dump contains stored credentials. 503 when the server has no file storage.',
    errors: [404, 503],
    operationId: 'exports.create',
    requestExample: example(CreateExportRequestSchema, { format: 'json' }),
    responseExample: EXPORT_EXAMPLE,
    status: 202,
    summary: 'Export account or workspace data',
    tags: ['exports'],
  }),
  requireAuth,
  fullAccess,
  zValidator('json', CreateExportRequestSchema),
  async (c) => new DataTransferController().createExport(c),
);

/** GET /api/v1/exports/:id */
ExportsRoutes.get(
  '/:id',
  routeDoc({
    data: ExportSchema,
    description:
      'Status of an export and a fresh signed `downloadUrl`. An export is visible only to the caller who made it, in the workspace it was made in; any other id answers 404.',
    errors: [404, 503],
    operationId: 'exports.get',
    responseExample: EXPORT_EXAMPLE,
    summary: 'Get an export',
    tags: ['exports'],
  }),
  requireAuth,
  fullAccess,
  zValidator('param', ExportIdParamSchema),
  async (c) => new DataTransferController().getExport(c),
);

export default ExportsRoutes;
