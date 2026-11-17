import { Hono } from 'hono';

import { routeDoc } from '../common/openapi';
import { zValidator } from '../common/validator';
import { ArtifactController } from '../controllers/artifact.controller';
import { requireAuth } from '../middleware/auth';
import { requireApiKeyScope } from '../middleware/permission-check';
import { ArtifactDeploymentSchema, PublishArtifactRequestSchema } from '../types/artifact.type';

/**
 * Artifact routes.
 *
 * Publishes an HTML page (with optional sidecar assets) to a public URL — the
 * same deployment `lh artifact publish` and the app's Publish button create.
 * Available on LobeHub Cloud; other servers answer 404. Restricted API keys
 * need `artifact:publish`; in a workspace the caller needs the member role.
 */
const ArtifactRoutes = new Hono();

ArtifactRoutes.post(
  '/',
  routeDoc({
    data: ArtifactDeploymentSchema,
    description:
      '**Publishes publicly.** Anyone with the returned `publicUrl` can open the page, and it stays up until unpublished. Pass `deploymentId` to publish a new revision of an existing site instead of creating one. Counts against the deployment quota of your plan. Answers 404 on servers without artifact publishing.',
    errors: [400, 402, 404, 409, 413],
    operationId: 'artifacts.publish',
    status: 201,
    summary: 'Publish an HTML artifact',
    tags: ['artifacts'],
  }),
  requireAuth,
  requireApiKeyScope('artifact:publish'),
  zValidator('json', PublishArtifactRequestSchema),
  async (c) => new ArtifactController().publish(c),
);

export default ArtifactRoutes;
